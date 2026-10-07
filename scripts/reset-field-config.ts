/**
 * Resets the 3 DEDICATED form-field-limit custom fields on each of the 6
 * entities (18 fields) back to blank Min/Max Length and "No Regex".
 *
 *   npm run reset:field-config -- --env qa --dry-run
 *   npm run reset:field-config -- --env qa
 *   npm run reset:field-config -- --env prod --confirm-prod
 *
 * WHY this exists (ADR 0009): the formFields tests mutate account-wide field
 * configuration and clean up after themselves, but a killed/cancelled run, or a
 * failed afterAll, can leave limits behind. Those leftovers cannot affect core
 * tests (no core test touches these fields — docs/known-issues/form-fields.md),
 * but they poison the NEXT formFields run's starting state. This tool restores
 * the baseline; CI runs it once after both test tracks finish.
 *
 * SCOPE, deliberately closed: only cfFormFieldLimitText / cfFormFieldLimitNumber
 * / cfFormFieldLimitParagraph (names come from the six *_FORM_FIELD_LIMIT_NAMES
 * factory constants the specs themselves use). The old shared fields
 * (cfTextField, cfNumber, cfParagraphText, ...) are never configured by the
 * formFields feature any more and are never touched here.
 *
 * Modes:
 *   --dry-run      Only READS each field's config and prints the non-blank ones.
 *                  Never clicks Submit, never writes a file.
 *   (default)      Reads, clears non-blank fields via
 *                  FormFieldsConfigPage.clearFieldConfiguration() (which itself
 *                  skips blank fields), re-reads each from a FRESH page load to
 *                  verify, prints entity/field/before/after, and writes
 *                  reports/<env>/field-config-reset.json for the email.
 *
 * Exit codes: 0 ok · 1 at least one field could not be read/reset/verified ·
 * 2 usage error (nothing was touched).
 *
 * Auth: reuses AuthManager's admin login + storage state (src/auth/storageStates/
 * <env>/admin.json), the same path every test fixture uses.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';
import {
  FieldConfigResetRecord,
  FieldConfigResetReport,
  getFieldConfigResetPath,
} from '../src/notifications/FieldConfigReset';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type {
  FieldConfigSnapshot,
  FormFieldsEntityConfig,
} from '../src/modules/formFields/FormFieldsConfigPage';

type TargetEnv = 'qa' | 'staging' | 'prod';
const VALID_ENVS: readonly TargetEnv[] = ['qa', 'staging', 'prod'];

interface CliOptions {
  env: TargetEnv;
  dryRun: boolean;
  confirmProd: boolean;
}

interface FieldTarget {
  entityLabel: string;
  entity: FormFieldsEntityConfig;
  internalName: string;
}

// WHY these budgets mirror globalSetup.ts's withTransientRetry() (3 attempts,
// 5s/10s backoff) rather than a new shape: that is this repo's existing bounded
// transient-retry pattern. The values are NOT independently measured for this
// tool (CLAUDE.md rule 19) — they are inherited; exhaustion fails loudly (the
// field is recorded `failed` and the exit code is 1), never guesses.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [5000, 10000];
// WHY a hard per-attempt deadline on top of page.setDefaultTimeout(): there is
// no Playwright test timeout around this script, so one wedged call (a locator
// read with no timeout of its own) would otherwise hang the whole process until
// the CI job's own timeout. Sized generously over a normal field (~20-40s).
const ATTEMPT_DEADLINE_MS = 5 * 60 * 1000;

const USAGE =
  'Usage: npm run reset:field-config -- --env <qa|staging|prod> [--dry-run] [--confirm-prod]\n' +
  '  --env           required, no default\n' +
  '  --dry-run       read-only: print non-blank dedicated fields, submit nothing\n' +
  '  --confirm-prod  required to RESET (not to dry-run) against prod';

function usageError(message: string): never {
  logger.error(message);
  logger.error(USAGE);
  process.exit(2);
}

function parseArgs(argv: string[]): CliOptions {
  let env: string | undefined;
  let dryRun = false;
  let confirmProd = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--confirm-prod') confirmProd = true;
    else if (arg === '--env') env = argv[++i];
    else if (arg.startsWith('--env=')) env = arg.slice('--env='.length);
    else if (arg === '--help' || arg === '-h') {
      logger.info(USAGE);
      process.exit(0);
    } else usageError(`Unknown argument: ${arg}`);
  }
  if (!env) usageError('--env is required (qa|staging|prod); there is no default.');
  if (!VALID_ENVS.includes(env as TargetEnv)) {
    usageError(`Invalid --env "${env}" — must be one of: ${VALID_ENVS.join(', ')}.`);
  }
  const target = env as TargetEnv;
  // WHY fail on a conflicting ENV rather than silently preferring one: config.ts
  // picks the account from process.env.ENV, so two disagreeing values could aim a
  // reset at a different account than the operator typed.
  if (process.env.ENV && process.env.ENV !== target) {
    usageError(`ENV=${process.env.ENV} in the environment conflicts with --env ${target}. Unset ENV or make them match.`);
  }
  if (target === 'prod' && !dryRun && !confirmProd) {
    usageError('Refusing to RESET prod without --confirm-prod. (--dry-run on prod needs no flag: it is read-only.)');
  }
  return { env: target, dryRun, confirmProd };
}

function describe(snapshot: FieldConfigSnapshot | null): string {
  if (!snapshot) return '(not read)';
  return `min=${snapshot.min || '-'} max=${snapshot.max || '-'} regex=${snapshot.regexLabel || 'n/a'}`;
}

function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded its ${ms / 1000}s deadline`)), ms);
  });
  // An abandoned attempt can still reject later (its context gets closed under
  // it); without this that rejection would surface as an unhandled rejection.
  work.catch(() => undefined);
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function printTable(rows: FieldConfigResetRecord[]): void {
  const cols: Array<[string, (r: FieldConfigResetRecord) => string]> = [
    ['ENTITY', (r) => r.entity],
    ['FIELD', (r) => r.field],
    ['BEFORE', (r) => r.before],
    ['AFTER', (r) => r.after],
    ['STATUS', (r) => (r.error ? `${r.status}: ${r.error}` : r.status)],
  ];
  const widths = cols.map(([title, get]) => Math.max(title.length, ...rows.map((r) => get(r).length)));
  logger.info(cols.map(([title], i) => pad(title, widths[i])).join('  '));
  logger.info(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) logger.info(cols.map(([, get], i) => pad(get(row), widths[i])).join('  '));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // WHY set before any config-dependent import: config/config.ts reads ENV and
  // validates the account's secrets once, at module load.
  process.env.ENV = options.env;

  const { chromium } = await import('@playwright/test');
  const { config } = await import('../config/config');
  const { AuthManager, registerPageForRecovery } = await import('../src/auth/authManager');
  const { FormFieldsConfigPage, NO_REGEX_OPTION_LABEL } = await import(
    '../src/modules/formFields/FormFieldsConfigPage'
  );
  const { LEAD_FORM_FIELD_LIMIT_NAMES } = await import('../src/data/factories/leadFactory');
  const { CONTACT_FORM_FIELD_LIMIT_NAMES } = await import('../src/data/factories/contactFactory');
  const { COMPANY_FORM_FIELD_LIMIT_NAMES } = await import('../src/data/factories/companyFactory');
  const { TASK_FORM_FIELD_LIMIT_NAMES } = await import('../src/data/factories/taskFactory');
  const { DEAL_FORM_FIELD_LIMIT_NAMES } = await import('../src/data/factories/dealFactory');
  const { PRODUCTS_FORM_FIELD_LIMIT_NAMES } = await import(
    '../src/data/factories/productsAndServicesFactory'
  );

  // Entity tab labels / URL slugs mirror the per-spec *_ENTITY constants in
  // tests/ui/formFields/*.spec.ts (each spec declares its own private copy). A
  // drift would show up here as a failed read, never a silent wrong-field write.
  const entities: Array<{
    label: string;
    entity: FormFieldsEntityConfig;
    names: { textField: string; number: string; paragraphText: string };
  }> = [
    { label: 'lead', entity: { tabLabel: 'Lead', urlSlug: 'leads' }, names: LEAD_FORM_FIELD_LIMIT_NAMES },
    { label: 'contact', entity: { tabLabel: 'Contact', urlSlug: 'contacts' }, names: CONTACT_FORM_FIELD_LIMIT_NAMES },
    { label: 'company', entity: { tabLabel: 'Company', urlSlug: 'companies' }, names: COMPANY_FORM_FIELD_LIMIT_NAMES },
    { label: 'task', entity: { tabLabel: 'Task', urlSlug: 'tasks' }, names: TASK_FORM_FIELD_LIMIT_NAMES },
    { label: 'deal', entity: { tabLabel: 'Deal', urlSlug: 'deals' }, names: DEAL_FORM_FIELD_LIMIT_NAMES },
    {
      label: 'productsAndServices',
      entity: { tabLabel: 'Product & Service', urlSlug: 'products-services' },
      names: PRODUCTS_FORM_FIELD_LIMIT_NAMES,
    },
  ];
  const targets: FieldTarget[] = entities.flatMap(({ label, entity, names }) =>
    [names.textField, names.number, names.paragraphText].map((suffix) => ({
      entityLabel: label,
      entity,
      internalName: `cf${suffix}`,
    }))
  );

  const isBlank = (s: FieldConfigSnapshot): boolean =>
    s.min === '' && s.max === '' && (s.regexLabel === '' || s.regexLabel === NO_REGEX_OPTION_LABEL);

  const mode = options.dryRun ? 'dry-run' : 'reset';
  logger.info(
    `reset-field-config: env=${options.env} (${config.appUrl}) mode=${mode} — ${targets.length} dedicated fields on ${entities.length} entities`
  );
  if (options.env === 'prod' && !options.dryRun) {
    logger.warn('PROD reset confirmed via --confirm-prod — non-blank dedicated field limits will be cleared.');
  }

  const reportPath = getFieldConfigResetPath(options.env);
  const report: FieldConfigResetReport = {
    env: options.env,
    mode,
    startedAt: new Date().toISOString(),
    complete: false,
    totalFields: targets.length,
    records: [],
  };
  // WHY written after every field (reset mode only): a job killed by its timeout
  // or a force-cancel still leaves a partial, honest `complete:false` report for
  // the email. Dry-run never writes a file, so a local audit can't leave a stale
  // report that a later `npm run notify` would pick up.
  const persist = (): void => {
    if (options.dryRun) return;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  };
  if (!options.dryRun) {
    fs.rmSync(reportPath, { force: true });
    persist();
  }

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  interface Session {
    context: BrowserContext;
    page: Page;
  }
  let session: Session | null = null;
  const closeSession = async (): Promise<void> => {
    if (!session) return;
    await session.page.close().catch(() => undefined);
    await session.context.close().catch(() => undefined);
    session = null;
  };
  const openSession = async (): Promise<Session> => {
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('admin');
    const page = await context.newPage();
    // Bounds every Playwright call that has no timeout of its own (inputValue,
    // isDisabled, innerText, ...) — there is no test timeout around this script.
    page.setDefaultTimeout(config.timeouts.navigation);
    registerPageForRecovery(page, 'admin', authManager);
    return { context, page };
  };

  const processField = async (target: FieldTarget): Promise<FieldConfigResetRecord> => {
    let before: FieldConfigSnapshot | null = null;
    let after: FieldConfigSnapshot | null = null;
    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await withDeadline(
          (async () => {
            if (!session) session = await openSession();
            const configPage = new FormFieldsConfigPage(session.page, target.entity);
            const read = await configPage.readFieldConfigFresh(target.internalName);
            // `before` is the first successful read — kept across retries so a
            // half-applied attempt never rewrites what the field originally held.
            if (!before) before = read;
            after = read;
            if (isBlank(read) || options.dryRun) return;
            await configPage.clearFieldConfiguration(target.internalName);
            after = await configPage.readFieldConfigFresh(target.internalName);
            if (!isBlank(after)) {
              throw new Error(`still non-blank after reset (${describe(after)})`);
            }
          })(),
          ATTEMPT_DEADLINE_MS,
          `${target.entityLabel}/${target.internalName}`
        );
        const original = before as FieldConfigSnapshot | null;
        const wasBlank = original ? isBlank(original) : true;
        return {
          entity: target.entityLabel,
          field: target.internalName,
          before: describe(original),
          after: describe(after),
          status: wasBlank ? 'blank' : options.dryRun ? 'non-blank' : 'cleared',
        };
      } catch (error) {
        lastError = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300);
        logger.warn(
          `${target.entityLabel}/${target.internalName}: attempt ${attempt}/${MAX_ATTEMPTS} failed — ${lastError}`
        );
        // A fresh context for every retry: a wedged page must not poison the next try.
        await closeSession();
        if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
      }
    }
    return {
      entity: target.entityLabel,
      field: target.internalName,
      before: describe(before),
      after: describe(after),
      status: 'failed',
      error: lastError,
    };
  };

  try {
    for (const target of targets) {
      const record = await processField(target);
      report.records.push(record);
      persist();
      logger.info(`${record.entity}/${record.field}: ${record.status}`);
    }
  } finally {
    await closeSession();
    await browser.close().catch(() => undefined);
  }

  report.complete = true;
  report.finishedAt = new Date().toISOString();
  persist();

  const failed = report.records.filter((r) => r.status === 'failed');
  const nonBlankBefore = report.records.filter((r) => r.status === 'non-blank' || r.status === 'cleared');
  const cleared = report.records.filter((r) => r.status === 'cleared');

  if (options.dryRun) {
    const shown = report.records.filter((r) => r.status === 'non-blank' || r.status === 'failed');
    if (shown.length > 0) printTable(shown);
    logger.info(
      `dry-run: ${targets.length} fields checked — ${report.records.filter((r) => r.status === 'blank').length} blank, ` +
        `${nonBlankBefore.length} non-blank, ${failed.length} could not be read. Nothing was submitted.`
    );
  } else {
    printTable(report.records);
    logger.info(
      `reset: ${targets.length} fields — ${report.records.filter((r) => r.status === 'blank').length} already blank, ` +
        `${cleared.length} cleared and verified blank from a fresh load, ${failed.length} FAILED.`
    );
    if (process.env.GITHUB_ACTIONS) {
      for (const r of failed) {
        // GitHub workflow-command annotation; newlines/percent are escaped per its syntax.
        const text = `${r.entity}/${r.field}: ${r.error ?? 'failed'}`.replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
        process.stdout.write(`::warning title=Dedicated field reset failed (${options.env})::${text}\n`);
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        const lines = [
          `### Dedicated form-field reset — ${options.env}`,
          '',
          '| Entity | Field | Before | After | Status |',
          '|---|---|---|---|---|',
          ...report.records.map(
            (r) => `| ${r.entity} | ${r.field} | ${r.before} | ${r.after} | ${r.error ? `${r.status}: ${r.error}` : r.status} |`
          ),
          '',
        ];
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
      }
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  logger.error('reset-field-config crashed before completing', error);
  process.exit(1);
});
