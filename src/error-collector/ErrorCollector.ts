import * as fs from 'fs';
import * as path from 'path';
import { isNoise } from './errorFilters';

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
  statusCode?: number;
  testTitle?: string;
  testFile?: string;
  timestamp: string;
  env?: string;
}

export interface MiscErrorReport {
  capturedAt: string;
  totalErrors: number;
  byType: Record<string, number>;
  errors: MiscError[];
}

const OUTPUT_PATH = path.resolve(process.cwd(), 'reports', 'misc-errors.json');

class ErrorCollectorSingleton {
  private errors: MiscError[] = [];
  private currentTestTitle = 'unknown';
  private currentTestFile  = 'unknown';
  private nodeListenersAttached = false;

  setCurrentTest(title: string, file: string): void {
    this.currentTestTitle = title;
    this.currentTestFile  = file;
  }

  clearCurrentTest(): void {
    this.currentTestTitle = 'unknown';
    this.currentTestFile  = 'unknown';
  }

  capture(error: Omit<MiscError, 'timestamp' | 'testTitle' | 'testFile'>): void {
    try {
      if (isNoise(error.message, error.url)) return;
      const entry: MiscError = {
        ...error,
        testTitle: this.currentTestTitle,
        testFile:  this.currentTestFile,
        timestamp: new Date().toISOString(),
        env:       process.env.ENV || 'qa',
      };
      this.errors.push(entry);
      this.persist();
      console.log(`\n[MiscError] [${entry.type.toUpperCase()}] ${entry.message}`);
      if (entry.url)        console.log(`            URL: ${entry.url}`);
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
    return {
      capturedAt:  new Date().toISOString(),
      totalErrors: this.errors.length,
      byType,
      errors:      this.errors,
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
