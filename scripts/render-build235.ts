/**
 * Renders the email of build #235 (sandbox, run 45122485029) from the committed fixture through the real pipeline
 * (scripts/lib/build235Fixture.ts) and writes the HTML next to its size.
 *
 *   npx ts-node scripts/render-build235.ts --out <file.html> [--with-skip-reason]
 *
 * --blocked: the run whose renew-session job failed (sandbox 45420781016: admin 37 min left, logout + login gave the same session).
 * --with-skip-reason: the skipped test carries the `skip-reason` annotation tests/ui/call-logs/call-logs.spec.ts has now
 * (build #235's own report had none).
 */
import * as fs from 'fs';
import { replayBuild235 } from './lib/build235Fixture';

const i = process.argv.indexOf('--out');
const out = i > 0 ? process.argv[i + 1] : undefined;
const blocked = process.argv.includes('--blocked')
  ? {
      cause: 'renew-session:failure',
      renewalFailure: {
        version: 1 as const, role: 'admin', kind: 'not-renewed-after-logout' as const, minutesLeft: 37, endIso: '2026-11-24T15:42:07.402Z', windowMin: 240,
        sameSession: true, oldTokenStatusAfterLogout: 200, message: 'The admin session has only 37 min left after logout and a fresh login', at: '2026-11-24T15:05:00.000Z',
      },
    }
  : undefined;
const r = replayBuild235({ withSkipReason: process.argv.includes('--with-skip-reason'), blockedBySession: blocked });
const bytes = Buffer.byteLength(r.sent, 'utf8');
if (out) fs.writeFileSync(out, r.sent);
process.stdout.write(`subject: ${r.subject}\nhtml: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB)${out ? ` -> ${out}` : ''}\n`);
process.stdout.write(
  `first run ${JSON.stringify(r.summary.firstRun)}\nafter rerun ${JSON.stringify(r.summary.afterRerun)}\nparsed: total ${r.report.total} passed ${r.report.passed} failed ${r.report.failed} flaky ${r.report.flaky} skipped ${r.report.skipped}; passRate ${r.report.passRate}\n`
);
