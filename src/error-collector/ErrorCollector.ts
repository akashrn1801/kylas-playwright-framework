import * as fs from 'fs';
import * as path from 'path';
import { isNoise, isExpectedRbacError } from './errorFilters';

export type MiscErrorType =
  | 'pageerror'
  | 'console-error'
  | 'requestfailed'
  | 'response-error'
  | 'node-exception'
  | 'node-rejection';

export interface MiscError {
  type: MiscErrorType;
  message: string;
  url?: string;
  method?: string;
  statusCode?: number;
  responseBody?: string;
  apiErrorMessage?: string;
  expected?: boolean; // WHY: true = expected RBAC behaviour, not a real bug
  testTitle?: string;
  testFile?: string;
  timestamp: string;
  env?: string;
}

export interface MiscErrorReport {
  capturedAt: string;
  totalErrors: number;
  unexpectedErrors: number;
  expectedRbacErrors: number;
  byType: Record<string, number>;
  errors: MiscError[];
}

const OUTPUT_PATH = path.resolve(process.cwd(), 'reports', 'misc-errors.json');

class ErrorCollectorSingleton {
  private errors: MiscError[] = [];
  private recentKeys = new Set<string>(); // WHY: dedup same error within 2s window
  private currentTestTitle = 'unknown';
  private currentTestFile = 'unknown';
  private nodeListenersAttached = false;

  setCurrentTest(title: string, file: string): void {
    this.currentTestTitle = title;
    this.currentTestFile = file;
  }

  clearCurrentTest(): void {
    this.currentTestTitle = 'unknown';
    this.currentTestFile = 'unknown';
  }

  capture(error: Omit<MiscError, 'timestamp' | 'testTitle' | 'testFile'>): void {
    try {
      if (isNoise(error.message, error.url)) return;
      // WHY: Filter ERR_ABORTED on non-CRM URLs — navigation aborts when page navigates away
      const isAbort = error.message && error.message.includes('ERR_ABORTED');
      const isCrmUrl =
        error.url && (error.url.includes('sling-dev.com') || error.url.includes('kylas.io'));
      if (isAbort && !isCrmUrl) return;
      // WHY: Deduplicate — same error from multiple page listeners within 2s window
      const dedupKey = `${error.type}:${error.url || error.message.substring(0, 50)}`;
      if (this.recentKeys.has(dedupKey)) return;
      this.recentKeys.add(dedupKey);
      setTimeout(() => this.recentKeys.delete(dedupKey), 2000);
      // WHY: Mark RBAC permission errors as expected — they are correct app behaviour
      const expected = isExpectedRbacError(error.message, (error as any).apiErrorMessage);

      const entry: MiscError = {
        ...error,
        expected,
        testTitle: this.currentTestTitle,
        testFile: this.currentTestFile,
        timestamp: new Date().toISOString(),
        env: process.env.ENV || 'qa',
      };
      this.errors.push(entry);
      this.persist();
      console.log(`\n[MiscError] [${entry.type.toUpperCase()}] ${entry.message}`);
      if (entry.url) console.log(`            URL: ${entry.url}`);
      if (entry.statusCode) console.log(`            Status: ${entry.statusCode}`);
      console.log(`            Test: ${entry.testTitle}`);
      console.log(`            Time: ${entry.timestamp}\n`);
    } catch {}
  }

  attachNodeListeners(): void {
    if (this.nodeListenersAttached) return;
    this.nodeListenersAttached = true;
    process.on('uncaughtException', (err: Error) => {
      if (err.message?.includes('playwright') || err.message?.includes('expect(')) return;
      this.capture({ type: 'node-exception', message: err.message || String(err) });
    });
    process.on('unhandledRejection', (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message?.includes('playwright') || message?.includes('Target page')) return;
      this.capture({ type: 'node-rejection', message });
    });
  }

  getReport(): MiscErrorReport {
    const byType: Record<string, number> = {};
    for (const e of this.errors) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    const unexpectedErrors = this.errors.filter((e) => !e.expected).length;
    const expectedRbacErrors = this.errors.filter((e) => e.expected).length;
    return {
      capturedAt: new Date().toISOString(),
      totalErrors: this.errors.length,
      unexpectedErrors,
      expectedRbacErrors,
      byType,
      errors: this.errors,
    };
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  private persist(): void {
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(this.getReport(), null, 2), 'utf-8');
    } catch {}
  }

  reset(): void {
    this.errors = [];
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(this.getReport(), null, 2), 'utf-8');
    } catch {}
  }
}

export const ErrorCollector = new ErrorCollectorSingleton();
