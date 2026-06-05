import { ParsedReport, ModuleStats, TestResult } from './ReportParser';

export interface EmailContext {
  report: ParsedReport;
  env: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  gitCommit: string;
  triggeredBy: string;
  allureUrl?: string;
}

export class EmailTemplate {
  subject(ctx: EmailContext): string {
    const icon   = ctx.report.status === 'passed' ? '✅' : ctx.report.status === 'failed' ? '❌' : '⚠️';
    const status = ctx.report.status.toUpperCase();
    return `${icon} [${ctx.env.toUpperCase()}] Kylas Automation — ${status} | Branch: ${ctx.branch} | Build #${ctx.buildNumber}`;
  }

  html(ctx: EmailContext): string {
    const { report, env, branch, buildNumber, buildUrl, gitCommit, triggeredBy, allureUrl } = ctx;
    const statusColor = report.status === 'passed' ? '#22c55e' : report.status === 'failed' ? '#ef4444' : '#f59e0b';
    const statusLabel = report.status === 'passed' ? '✅ PASSED' : report.status === 'failed' ? '❌ FAILED' : '⚠️ UNSTABLE';
    const envColor    = env === 'prod' ? '#7c3aed' : env === 'staging' ? '#0891b2' : '#059669';
    const duration    = this.formatDuration(report.duration);
    const startTime   = new Date(report.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const endTime     = new Date(report.endTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const shortCommit = gitCommit.substring(0, 8);
    const today       = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const moduleRows = report.modules.map((m: ModuleStats) => {
      const passRate = m.total > 0 ? Math.round((m.passed / m.total) * 100) : 0;
      const barColor = m.failed > 0 ? '#ef4444' : m.flaky > 0 ? '#f59e0b' : '#22c55e';
      const typeStyle = m.type === 'UI' ? 'background:#dbeafe;color:#1d4ed8;' : 'background:#dcfce7;color:#15803d;';
      return `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:8px;font-size:12px;color:#111827;font-weight:500;">${this.esc(m.name)}</td>
        <td style="padding:8px;"><span style="${typeStyle}padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${m.type}</span></td>
        <td style="padding:8px;text-align:center;font-size:12px;color:#16a34a;font-weight:700;">${m.passed}</td>
        <td style="padding:8px;text-align:center;font-size:12px;color:${m.flaky > 0 ? '#f59e0b' : '#9ca3af'};font-weight:${m.flaky > 0 ? '700' : '400'};">${m.flaky}</td>
        <td style="padding:8px;text-align:center;font-size:12px;color:${m.failed > 0 ? '#ef4444' : '#9ca3af'};font-weight:${m.failed > 0 ? '700' : '400'};">${m.failed}</td>
        <td style="padding:8px;width:80px;"><div style="background:#e5e7eb;border-radius:4px;height:6px;"><div style="background:${barColor};width:${passRate}%;height:6px;border-radius:4px;"></div></div></td>
      </tr>`;
    }).join('');

    const slowestRows = report.slowestTests.map((t: TestResult) => `
      <tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:6px 0;font-size:12px;color:#374151;">${this.esc(t.title)}</td>
        <td style="padding:6px 0;text-align:right;font-size:12px;color:#6b7280;font-weight:600;white-space:nowrap;">${Math.round(t.duration / 1000)}s</td>
      </tr>`).join('');

    const failedRows = report.failedTests.map((t: TestResult) => `
      <tr style="border-bottom:1px solid #fee2e2;">
        <td style="padding:8px;color:#1f2937;font-size:12px;">${this.esc(t.title)}</td>
        <td style="padding:8px;color:#6b7280;font-size:11px;">${t.file.split('/').pop() || ''}</td>
        <td style="padding:8px;color:#ef4444;font-size:11px;font-family:monospace;">${this.esc(t.error || 'Unknown error')}</td>
      </tr>`).join('');

    const flakyRows = report.flakyTests.map((t: TestResult) => `
      <tr style="border-bottom:1px solid #fef3c7;">
        <td style="padding:6px 0;font-size:12px;color:#374151;">${this.esc(t.title)}</td>
        <td style="padding:6px 0;text-align:right;font-size:11px;color:#f59e0b;font-weight:600;">${t.retries} retry</td>
      </tr>`).join('');

    const jenkinsBuildUrl = buildUrl || `http://localhost:8080/job/kylas-automation/job/${env === 'staging' ? 'stage' : env}/lastBuild/`;
    const allureReportUrl = allureUrl || (jenkinsBuildUrl + 'allure/');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">

<tr><td style="background:linear-gradient(135deg,#1e1b4b,#4338ca);padding:28px 32px;">
  <div style="font-size:26px;font-weight:800;color:#ffffff;">Kylas <span style="font-weight:300;color:#a5b4fc;">QA Automation</span></div>
  <div style="font-size:12px;color:#c7d2fe;margin-top:4px;">Test Execution Report — ${today}</div>
</td></tr>

<tr><td style="background:${statusColor};padding:14px;text-align:center;">
  <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">${statusLabel}</span>
</td></tr>

<tr><td style="padding:16px 32px 8px;">
  <span style="display:inline-block;background:${envColor};color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-right:6px;">ENV: ${env.toUpperCase()}</span>
  <span style="display:inline-block;background:#2563eb;color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-right:6px;">BRANCH: ${this.esc(branch)}</span>
  <span style="display:inline-block;background:#374151;color:#fff;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;">BUILD #${this.esc(buildNumber)}</span>
</td></tr>

<tr><td style="padding:8px 32px;">
  <table width="100%" cellpadding="6" cellspacing="0">
    <tr>
      <td width="24%" align="center" style="background:#f9fafb;border-radius:12px;padding:16px 8px;">
        <div style="font-size:28px;font-weight:800;color:#111827;">${report.total}</div>
        <div style="font-size:11px;color:#6b7280;font-weight:600;margin-top:2px;">TOTAL</div>
      </td>
      <td width="2%"></td>
      <td width="24%" align="center" style="background:#f0fdf4;border-radius:12px;padding:16px 8px;">
        <div style="font-size:28px;font-weight:800;color:#16a34a;">${report.passed}</div>
        <div style="font-size:11px;color:#6b7280;font-weight:600;margin-top:2px;">PASSED</div>
      </td>
      <td width="2%"></td>
      <td width="24%" align="center" style="background:#fffbeb;border-radius:12px;padding:16px 8px;">
        <div style="font-size:28px;font-weight:800;color:#f59e0b;">${report.flaky}</div>
        <div style="font-size:11px;color:#6b7280;font-weight:600;margin-top:2px;">FLAKY</div>
      </td>
      <td width="2%"></td>
      <td width="24%" align="center" style="background:#fef2f2;border-radius:12px;padding:16px 8px;">
        <div style="font-size:28px;font-weight:800;color:#ef4444;">${report.failed}</div>
        <div style="font-size:11px;color:#6b7280;font-weight:600;margin-top:2px;">FAILED</div>
      </td>
    </tr>
  </table>
</td></tr>

<tr><td style="padding:8px 32px;">
  <div style="background:#f9fafb;border-radius:12px;padding:20px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="110" valign="middle">
          <table width="100" cellpadding="0" cellspacing="0" style="border:3px solid ${statusColor};border-radius:10px;background:#ffffff;">
            <tr><td align="center" style="padding:12px 8px;">
              <div style="font-size:26px;font-weight:800;color:${statusColor};line-height:1;">${report.passRate}%</div>
              <div style="font-size:9px;color:#6b7280;font-weight:600;margin-top:4px;">PASS RATE</div>
              <div style="background:#e5e7eb;border-radius:4px;height:5px;margin-top:6px;">
                <div style="background:${statusColor};width:${report.passRate}%;height:5px;border-radius:4px;"></div>
              </div>
            </td></tr>
          </table>
        </td>
        <td style="padding-left:20px;">
          <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">Execution Summary</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">⏱ Duration: ${duration}</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">🕐 Started: ${startTime}</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">🏁 Ended: ${endTime}</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">👤 Triggered by: ${this.esc(triggeredBy)}</div>
          <div style="font-size:12px;color:#6b7280;">🔀 Commit: ${this.esc(shortCommit)}</div>
        </td>
      </tr>
    </table>
  </div>
</td></tr>

<tr><td style="padding:8px 32px;">
  <div style="background:#f9fafb;border-radius:12px;padding:20px;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">🧪 Test Type Split</div>
    <table width="100%" cellpadding="0" cellspacing="8">
      <tr>
        <td width="49%" align="center" style="background:#eff6ff;border-radius:8px;padding:12px;">
          <div style="font-size:22px;font-weight:800;color:#1d4ed8;">${report.uiCount}</div>
          <div style="font-size:11px;color:#6b7280;font-weight:600;">UI TESTS</div>
        </td>
        <td width="2%"></td>
        <td width="49%" align="center" style="background:#f0fdf4;border-radius:8px;padding:12px;">
          <div style="font-size:22px;font-weight:800;color:#15803d;">${report.rbacCount}</div>
          <div style="font-size:11px;color:#6b7280;font-weight:600;">RBAC TESTS</div>
        </td>
      </tr>
    </table>
  </div>
</td></tr>

<tr><td style="padding:8px 32px;">
  <div style="background:#f9fafb;border-radius:12px;padding:20px;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">📦 Module Breakdown</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr style="background:#f3f4f6;">
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Module</th>
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Type</th>
        <th style="padding:6px 8px;text-align:center;font-size:11px;color:#16a34a;font-weight:600;">Pass</th>
        <th style="padding:6px 8px;text-align:center;font-size:11px;color:#f59e0b;font-weight:600;">Flaky</th>
        <th style="padding:6px 8px;text-align:center;font-size:11px;color:#ef4444;font-weight:600;">Fail</th>
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Progress</th>
      </tr>
      ${moduleRows}
    </table>
  </div>
</td></tr>

${report.slowestTests.length > 0 ? `
<tr><td style="padding:8px 32px;">
  <div style="background:#f9fafb;border-radius:12px;padding:20px;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">🐢 Slowest Tests (Top 5)</div>
    <table width="100%" cellpadding="0" cellspacing="0">${slowestRows}</table>
  </div>
</td></tr>` : ''}

${report.flakyTests.length > 0 ? `
<tr><td style="padding:8px 32px;">
  <div style="background:#fffbeb;border-radius:12px;padding:20px;border:1px solid #fde68a;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">⚠️ Flaky Tests (${report.flakyTests.length})</div>
    <table width="100%" cellpadding="0" cellspacing="0">${flakyRows}</table>
  </div>
</td></tr>` : ''}

${report.failedTests.length > 0 ? `
<tr><td style="padding:8px 32px;">
  <div style="background:#fff;border-radius:12px;padding:20px;border:1px solid #fecaca;">
    <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:12px;">❌ Failed Tests (${report.failedTests.length})</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr style="background:#fef2f2;">
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Test</th>
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">File</th>
        <th style="padding:6px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;">Error</th>
      </tr>
      ${failedRows}
    </table>
  </div>
</td></tr>` : ''}

<tr><td style="padding:16px 32px;text-align:center;">
  <a href="${jenkinsBuildUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;margin-right:8px;">🔍 Jenkins Build →</a>
  <a href="${allureReportUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">📊 Allure Report →</a>
</td></tr>

<tr><td style="padding:16px 32px;text-align:center;border-top:1px solid #f3f4f6;">
  <div style="font-size:11px;color:#9ca3af;">Sent by Kylas QA Automation System &nbsp;·&nbsp; akash.rn1908@gmail.com</div>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  private esc(str: string): string {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}
