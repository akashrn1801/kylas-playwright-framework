/**
 * Offline check (browser-install proposal, sandbox 44464192762): every `mcr.microsoft.com/playwright:vX.Y.Z-<os>` image
 * named in .github/workflows must carry the Playwright version locked in package-lock.json (the image's browsers are
 * built for exactly that version; a mismatch starts a job with no usable browser). Also checks that the container
 * expression only ever reads the PLAYWRIGHT_IMAGE variable or the canary's own matrix value, never a hardcoded image.
 * Run: npm run check:playwright-image
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
let failed = 0;
const check = (ok: boolean, name: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string }>;
};
const locked = lock.packages['node_modules/@playwright/test']?.version ?? '';
check(/^\d+\.\d+\.\d+$/.test(locked), `package-lock.json locks @playwright/test (${locked || 'not found'})`);

const workflowDir = path.join(root, '.github', 'workflows');
const imageRe = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-([a-z]+)/g;
let seen = 0;
for (const file of fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'))) {
  const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  for (const m of text.matchAll(imageRe)) {
    seen++;
    check(m[1] === locked, `${file}: image tag v${m[1]}-${m[2]} equals the locked Playwright ${locked}`);
  }
  for (const line of text.split('\n').filter((l) => /^\s+container:/.test(l))) {
    check(
      /\$\{\{.*(vars\.PLAYWRIGHT_IMAGE|matrix\.image)/.test(line) && !/mcr\.microsoft\.com/.test(line),
      `${file}: container expression reads only vars.PLAYWRIGHT_IMAGE / matrix.image (${line.trim().slice(0, 60)}...)`
    );
  }
}
check(seen >= 1, `at least one pinned image tag is checked (found ${seen}; the canary names it)`);

console.log(failed === 0 ? '\ncheck:playwright-image — all checks passed' : `\ncheck:playwright-image — ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
