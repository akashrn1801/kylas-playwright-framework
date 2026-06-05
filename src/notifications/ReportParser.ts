import * as fs from 'fs';

export interface TestResult {
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  duration: number;
  error?: string;
  retries: number;
  file: string;
}

export interface ParsedReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  duration: number;
  startTime: string;
  endTime: string;
  status: 'passed' | 'failed' | 'unstable';
  failedTests: TestResult[];
  flakyTests: TestResult[];
  passRate: number;
}

export class ReportParser {
  parse(jsonReportPath: string): ParsedReport {
    if (!fs.existsSync(jsonReportPath)) {
      throw new Error(`Report not found: ${jsonReportPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(jsonReportPath, 'utf-8'));
    const results = this.extractResults(raw);
    const total   = results.length;
    const passed  = results.filter(r => r.status === 'passed').length;
    const failed  = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const flaky   = results.filter(r => r.status === 'flaky').length;
    const duration = results.reduce((sum, r) => sum + r.duration, 0);
    const failedTests = results.filter(r => r.status === 'failed');
    const flakyTests  = results.filter(r => r.status === 'flaky');
    const status: ParsedReport['status'] = failed > 0 ? 'failed' : flaky > 0 ? 'unstable' : 'passed';
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const startTime = raw.startTime || new Date().toISOString();
    const endTime   = new Date(new Date(startTime).getTime() + duration).toISOString();
    return { total, passed, failed, skipped, flaky, duration, startTime, endTime, status, failedTests, flakyTests, passRate };
  }

  private extractResults(raw: any): TestResult[] {
    const results: TestResult[] = [];
    const walkSuite = (suite: any, file = '') => {
      const currentFile = suite.file || file;
      if (suite.specs) {
        for (const spec of suite.specs) {
          for (const test of spec.tests || []) {
            const retries    = (test.results || []).length - 1;
            const lastResult = test.results?.[test.results.length - 1];
            const status     = this.mapStatus(test.status, retries);
            const error      = lastResult?.error?.message || lastResult?.error?.value || undefined;
            results.push({
              title: spec.title, status,
              duration: lastResult?.duration || 0,
              error: error ? error.substring(0, 300) : undefined,
              retries, file: currentFile,
            });
          }
        }
      }
      for (const child of suite.suites || []) walkSuite(child, currentFile);
    };
    for (const suite of raw.suites || []) walkSuite(suite);
    return results;
  }

  private mapStatus(status: string, retries: number): 'passed' | 'failed' | 'skipped' | 'flaky' {
    if (status === 'expected')   return 'passed';
    if (status === 'unexpected') return retries > 0 ? 'flaky' : 'failed';
    if (status === 'flaky')      return 'flaky';
    if (status === 'skipped')    return 'skipped';
    return 'failed';
  }
}
