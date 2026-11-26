import * as fs from 'fs';
import * as path from 'path';
import { deriveModuleFromFile } from './ReportParser';

/**
 * How many tests each module has in the whole suite, from config/expected-test-counts.json (generated from `playwright --list`, never hand-edited).
 * Keyed "UI:Billing" / "RBAC:Billing", the same keys the report's modules use. A run that selects by tag runs fewer tests than the suite has
 * (build #242: a `--grep @regression` run skips the tests tagged only @smoke, so Billing UI ran 4 of 6); the email says so per module, so a short count
 * is explained instead of looking like a missing test. Missing or unreadable file: null, nothing is said.
 */
export function moduleBaseline(perFile: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [file, count] of Object.entries(perFile)) {
    const { name, type } = deriveModuleFromFile(file);
    out[`${type}:${name}`] = (out[`${type}:${name}`] ?? 0) + count;
  }
  return out;
}

export function loadSuiteBaseline(file: string = path.join(process.cwd(), 'config', 'expected-test-counts.json')): Record<string, number> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { perFile?: Record<string, number> };
    return parsed.perFile ? moduleBaseline(parsed.perFile) : null;
  } catch {
    return null;
  }
}
