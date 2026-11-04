/**
 * Offline check of BasePage's fail-fast waits (waitForRendered(), explainAppErrorPage(), click()) against a local
 * HTTP server and a real chromium: no Kylas environment, no login.
 *
 *   npm run check:fail-fast
 *
 * Each case reproduces a failure seen in the 2026-11-03 sandbox run (docs/known-issues, flaky-fix-3): a control that
 * can never appear because the app shows its error screen or a page-critical GET answered 429, and a click covered by
 * `<div class="app-error something-is-broken">`. They used to wait 120 s / the whole 480 s test timeout. Exit 1 on any
 * failed check.
 */
import * as http from 'http';
import { chromium, Locator } from '@playwright/test';
import { BasePage } from '../src/core/BasePage';

class Probe extends BasePage {
  rendered(locator: Locator, description: string, timeout?: number): Promise<void> {
    return this.waitForRendered(locator, description, timeout);
  }
  clicked(locator: Locator, description: string): Promise<void> {
    return this.click(locator, description);
  }
}

let failures = 0;
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const check = (ok: boolean, what: string, detail = ''): void => {
  if (!ok) failures += 1;
  out(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `  -> ${detail}` : ''}`);
};

const page = (body: string, script = ''): string => `<html><body>${body}<script>${script}</script></body></html>`;
const ROUTES: Record<string, string> = {
  '/ok': page('<input name="x">'),
  '/slow': page('<div id="m"></div>', "setTimeout(function(){document.getElementById('m').innerHTML='<input name=x>'},7000)"),
  '/broken': page('<div class="app-error something-is-broken">Something is broken here</div>'),
  '/skeleton': page('<div>skeleton</div>', "fetch('/v1/deals/1')"),
  '/covered': page('<button id="b">Type</button><div class="app-error something-is-broken" style="position:fixed;left:0;top:0;right:0;bottom:0;background:#fff">Something is broken here</div>'),
};

async function main(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/v1/deals/1')) {
      res.statusCode = 429;
      res.end('{}');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(ROUTES[req.url ?? ''] ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch();
  const pg = await browser.newPage();
  const probe = new Probe(pg);
  const input = pg.locator('input[name=x]');

  const timed = async (path: string, fn: () => Promise<void>): Promise<{ ms: number; error?: Error }> => {
    await pg.goto(base + path);
    const started = Date.now();
    try {
      await fn();
      return { ms: Date.now() - started };
    } catch (error) {
      return { ms: Date.now() - started, error: error as Error };
    }
  };

  let r = await timed('/ok', () => probe.rendered(input, 'present control'));
  check(!r.error && r.ms < 3000, 'a control that is there returns at once', `${r.ms} ms ${r.error?.message ?? ''}`);

  r = await timed('/slow', () => probe.rendered(input, 'slow control', 30000));
  check(!r.error && r.ms >= 6000 && r.ms < 12000, 'a control that renders after 7 s is still waited for (no false fail-fast)', `${r.ms} ms ${r.error?.message ?? ''}`);

  r = await timed('/broken', () => probe.rendered(input, 'form behind the error screen', 60000));
  check(!!r.error && /Something is broken/.test(r.error.message) && r.ms < 10000, 'the app error screen fails within seconds and names it', `${r.ms} ms ${r.error?.message ?? 'no error'}`);

  r = await timed('/skeleton', () => probe.rendered(input, 'form whose data GET answers 429', 60000));
  check(!!r.error && /GET \/v1\/deals\/\{id\} -> 429/.test(r.error.message) && r.ms < 25000, 'a 429 on the page\'s GET fails after the 15 s grace and names the request', `${r.ms} ms ${r.error?.message ?? 'no error'}`);

  r = await timed('/skeleton', () => probe.rendered(input, 'short budget', 8000));
  check(!!r.error && /Timeout 8000ms|Timeout \d+ms exceeded/.test(r.error.message), 'with a budget shorter than the grace the plain timeout error is unchanged', r.error?.message ?? 'no error');

  r = await timed('/covered', () => probe.clicked(pg.locator('#b'), 'type dropdown'));
  check(!!r.error && /error screen \("Something is broken"\)/.test(r.error.message) && r.ms < 25000, 'a click covered by the error screen fails in ~15 s (was 657 retries until the test timeout) and names it', `${r.ms} ms ${r.error?.message ?? 'no error'}`);

  await browser.close();
  server.close();
  out(failures === 0 ? '\ncheck:fail-fast — all checks passed' : `\ncheck:fail-fast — ${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  out(`check:fail-fast crashed: ${String(error)}`);
  process.exitCode = 1;
});
