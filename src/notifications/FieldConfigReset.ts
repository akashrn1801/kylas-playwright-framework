/**
 * Result of the post-run dedicated form-field reset (scripts/reset-field-config.ts,
 * the `reset-field-config` CI job) — shared shape between that writer and the
 * email's reader, so the two can never drift apart silently.
 *
 * WHY a file in reports/<env>/, read the same optional/graceful way
 * misc-errors.json and history-delta.json already are: the reset runs in its
 * own CI job, so its outcome reaches merge-and-report as an uploaded artifact.
 * If the job was skipped, crashed before writing, or the artifact is absent,
 * `loadFieldConfigReset()` returns null and the email simply omits the line —
 * it never fails notification, and never changes the run verdict, health score
 * or any test count (ADR 0009).
 */
import * as fs from 'fs';
import * as path from 'path';

export type FieldConfigResetStatus = 'blank' | 'cleared' | 'non-blank' | 'failed';

export interface FieldConfigResetRecord {
  entity: string;
  field: string;
  // Human-readable config before/after, e.g. "min=5 max=10 regex=Email".
  before: string;
  after: string;
  status: FieldConfigResetStatus;
  // Present only when status === 'failed'.
  error?: string;
}

export interface FieldConfigResetReport {
  env: string;
  mode: 'dry-run' | 'reset';
  startedAt: string;
  // Absent until the run finishes; `complete: false` with no finishedAt means
  // the process was killed mid-way (job timeout / force-cancel) and `records`
  // holds only the fields reached so far.
  finishedAt?: string;
  complete: boolean;
  totalFields: number;
  records: FieldConfigResetRecord[];
}

export function getFieldConfigResetPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'field-config-reset.json');
}

export function loadFieldConfigReset(env: string): FieldConfigResetReport | null {
  try {
    const file = getFieldConfigResetPath(env);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<FieldConfigResetReport>;
    if (!parsed || !Array.isArray(parsed.records) || typeof parsed.totalFields !== 'number') return null;
    return parsed as FieldConfigResetReport;
  } catch {
    return null;
  }
}
