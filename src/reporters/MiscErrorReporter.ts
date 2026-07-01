import type { Reporter, FullConfig, Suite, FullResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_PATH = path.resolve(process.cwd(), 'reports', 'misc-errors.json');
const WORKER_FILE_PATTERN = /^misc-errors-worker-.+\.json$/;

class MiscErrorReporter implements Reporter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onBegin(_config: FullConfig, _suite: Suite): void {
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // WHY: Clean up stale per-worker files left behind by a crashed previous
      // run, so onEnd()'s merge doesn't pick up errors from an unrelated run.
      for (const file of fs.readdirSync(dir)) {
        if (WORKER_FILE_PATTERN.test(file)) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {
            /* already removed */
          }
        }
      }
      const empty = {
        capturedAt: new Date().toISOString(),
        totalErrors: 0,
        byType: {},
        errors: [],
      };
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(empty, null, 2), 'utf-8');
    } catch {}
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onEnd(_result: FullResult): void {
    this.mergeWorkerReports();
    this.printTerminalSummary();
  }

  // WHY: Each worker wrote its own misc-errors-worker-<id>.json (see
  // ErrorCollector.ts) — merge them all into the single final misc-errors.json
  // that NotificationService.ts reads, then remove the per-worker files.
  private mergeWorkerReports(): void {
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const workerFiles = fs.readdirSync(dir).filter((f) => WORKER_FILE_PATTERN.test(f));

      const mergedErrors: any[] = [];
      for (const file of workerFiles) {
        const filePath = path.join(dir, file);
        try {
          const workerReport = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (Array.isArray(workerReport.errors)) {
            mergedErrors.push(...workerReport.errors);
          }
        } catch {
          /* skip unreadable/partial worker file */
        } finally {
          try {
            fs.unlinkSync(filePath);
          } catch {
            /* already removed */
          }
        }
      }

      const byType: Record<string, number> = {};
      for (const e of mergedErrors) {
        byType[e.type] = (byType[e.type] || 0) + 1;
      }

      const merged = {
        capturedAt: new Date().toISOString(),
        totalErrors: mergedErrors.length,
        unexpectedErrors: mergedErrors.filter((e) => !e.expected).length,
        expectedRbacErrors: mergedErrors.filter((e) => e.expected).length,
        byType,
        errors: mergedErrors,
      };

      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2), 'utf-8');
    } catch (err) {
      console.error('[MiscErrorReporter] Failed to merge worker reports:', err);
    }
  }

  private printTerminalSummary(): void {
    try {
      if (!fs.existsSync(OUTPUT_PATH)) {
        console.log('\n[MiscErrors] No misc-errors.json found.\n');
        return;
      }
      const report = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
      if (report.totalErrors === 0) {
        console.log('\n✅ [MiscErrors] No background errors captured during this run.\n');
        return;
      }
      console.log('\n' + '═'.repeat(70));
      console.log(`⚠️  MISCELLANEOUS BACKGROUND ERRORS — ${report.totalErrors} captured`);
      if (report.unexpectedErrors > 0)
        console.log(`   🔴 Unexpected (potential bugs): ${report.unexpectedErrors}`);
      if (report.expectedRbacErrors > 0)
        console.log(`   🟡 Expected RBAC behaviour:     ${report.expectedRbacErrors}`);
      console.log('═'.repeat(70));
      console.log('   Unexpected errors = review and raise bugs.');
      console.log(
        '   Expected RBAC errors = correct app behaviour (restricted user access denied).\n'
      );
      console.log('📊 Error Breakdown:');
      const icons: Record<string, string> = {
        pageerror: '💥',
        'console-error': '🔴',
        requestfailed: '📡',
        'response-error': '🌐',
        'node-exception': '⚡',
        'node-rejection': '⚡',
      };
      for (const [type, count] of Object.entries(report.byType as Record<string, number>)) {
        console.log(
          `   ${icons[type] || '❓'} ${type.padEnd(20)} ${count} error${count > 1 ? 's' : ''}`
        );
      }
      const byTest = new Map<string, any[]>();
      for (const e of report.errors) {
        const key = e.testTitle || 'unknown';
        if (!byTest.has(key)) byTest.set(key, []);
        byTest.get(key)!.push(e);
      }
      console.log('\n📋 Errors by Test:');
      for (const [testTitle, errors] of byTest.entries()) {
        console.log(`\n   🧪 ${testTitle}`);
        for (const e of errors) {
          console.log(`      ${icons[e.type] || '❓'} [${e.type}] ${e.message.substring(0, 120)}`);
          if (e.url) console.log(`            URL: ${e.url}`);
          if (e.method) console.log(`            Method: ${e.method}`);
          if (e.statusCode) console.log(`            HTTP ${e.statusCode}`);
          if (e.apiErrorMessage) console.log(`            Error: ${e.apiErrorMessage}`);
          if (e.responseBody)
            console.log(`            Response: ${e.responseBody.substring(0, 150)}`);
        }
      }
      console.log('\n' + '─'.repeat(70));
      console.log(`📁 Full report: ${OUTPUT_PATH}`);
      console.log('─'.repeat(70) + '\n');
    } catch (err) {
      console.error('[MiscErrorReporter] Error:', err);
    }
  }
}

export default MiscErrorReporter;
