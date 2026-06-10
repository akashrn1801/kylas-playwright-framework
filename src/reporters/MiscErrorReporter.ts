import type { Reporter, FullConfig, Suite, FullResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_PATH = path.resolve(process.cwd(), 'reports', 'misc-errors.json');

class MiscErrorReporter implements Reporter {

  onBegin(_config: FullConfig, _suite: Suite): void {
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const empty = { capturedAt: new Date().toISOString(), totalErrors: 0, byType: {}, errors: [] };
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(empty, null, 2), 'utf-8');
    } catch {}
  }

  onEnd(_result: FullResult): void {
    this.printTerminalSummary();
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
      console.log('═'.repeat(70));
      console.log('   These are NOT test failures. Review and raise bugs.\n');
      console.log('📊 Error Breakdown:');
      const icons: Record<string,string> = { 'pageerror':'💥','console-error':'🔴','requestfailed':'📡','response-error':'🌐','node-exception':'⚡','node-rejection':'⚡' };
      for (const [type, count] of Object.entries(report.byType as Record<string,number>)) {
        console.log(`   ${icons[type]||'❓'} ${type.padEnd(20)} ${count} error${count>1?'s':''}`);
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
          console.log(`      ${icons[e.type]||'❓'} [${e.type}] ${e.message.substring(0,120)}`);
          if (e.url)        console.log(`            URL: ${e.url}`);
          if (e.statusCode) console.log(`            HTTP ${e.statusCode}`);
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
