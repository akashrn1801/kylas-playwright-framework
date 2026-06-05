import { ParsedReport } from './ReportParser';

export interface EmailContext {
  report: ParsedReport;
  env: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  gitCommit: string;
  triggeredBy: string;
}

export class EmailTemplate {
  subject(ctx: EmailContext): string {
    const icon   = ctx.report.status === 'passed' ? '✅' : ctx.report.status === 'failed' ? '❌' : '⚠️';
    const status = ctx.report.status.toUpperCase();
    return `${icon} [${ctx.env.toUpperCase()}] Kylas Automation — ${status} | Branch: ${ctx.branch} | Build #${ctx.buildNumber}`;
  }

  html(ctx: EmailContext): string {
    const { report, env, branch, buildNumber, buildUrl, gitCommit, triggeredBy } = ctx;
    const statusColor = report.status === 'passed' ? '#22c55e' : report.status === 'failed' ? '#ef4444' : '#f59e0b';
    const statusLabel = report.status === 'passed' ? '✅ PASSED' : report.status === 'failed' ? '❌ FAILED' : '⚠️ UNSTABLE';
    const envColor    = env === 'prod' ? '#7c3aed' : env === 'staging' ? '#0891b2' : '#059669';
    const branchColor = branch === 'main' ? '#dc2626' : branch === 'prod' ? '#7c3aed' : '#2563eb';
    const duration    = this.formatDuration(report.duration);
    const startTime   = new Date(report.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const endTime     = new Date(report.endTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const shortCommit = gitCommit.substring(0, 8);

    const failedRows = report.failedTests.map(t => `
      <tr style="border-bottom:1px solid #fee2e2;">
        <td style="padding:10px 12px;color:#1f2937;font-size:13px;">${this.esc(t.title)}</td>
        <td style="padding:10px 12px;color:#6b7280;font-size:12px;">${t.file.split('/').pop() || ''}</td>
        <td style="padding:10px 12px;color:#ef4444;font-size:12px;font-family:monospace;">${this.esc(t.error || 'Unknown error')}</td>
      </tr>`).join('');

    const flakyRows = report.flakyTests.map(t => `
      <tr style="border-bottom:1px solid #fef3c7;">
        <td style="padding:10px 12px;color:#1f2937;font-size:13px;">${this.esc(t.title)}</td>
        <td style="padding:10px 12px;color:#6b7280;font-size:12px;">${t.file.split('/').pop() || ''}</td>
        <td style="padding:10px 12px;color:#f59e0b;font-size:12px;">Passed on retry (${t.retries} retries)</td>
      </tr>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#4338ca 100%);padding:32px 0;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0"><tr><td style="padding:0 24px;">
<div style="font-size:28px;font-weight:800;color:#ffffff;">Kylas <span style="font-weight:300;color:#a5b4fc;">QA Automation</span></div>
<div style="font-size:13px;color:#c7d2fe;">Test Execution Report — ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
</td></tr></table></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" style="background:${statusColor};padding:16px 0;">
<tr><td align="center"><span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:1px;">${statusLabel}</span></td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
<tr><td align="center"><table width="600" cellpadding="0" cellspacing="0">
<tr><td style="padding:0 24px 20px;">
<span style="display:inline-block;background:${envColor};color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-right:8px;">ENV: ${env.toUpperCase()}</span>
<span style="display:inline-block;background:${branchColor};color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;margin-right:8px;">BRANCH: ${branch}</span>
<span style="display:inline-block;background:#374151;color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">BUILD #${buildNumber}</span>
</td></tr>
<tr><td style="padding:0 24px 20px;">
<table width="100%" cellpadding="8" cellspacing="0">
<tr>
<td width="25%" align="center" style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:32px;font-weight:800;color:#1f2937;">${report.total}</div>
<div style="font-size:12px;color:#6b7280;font-weight:500;">TOTAL</div>
</td>
<td width="25%" align="center" style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:32px;font-weight:800;color:#22c55e;">${report.passed}</div>
<div style="font-size:12px;color:#6b7280;font-weight:500;">PASSED</div>
</td>
<td width="25%" align="center" style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:32px;font-weight:800;color:#ef4444;">${report.failed}</div>
<div style="font-size:12px;color:#6b7280;font-weight:500;">FAILED</div>
</td>
<td width="25%" align="center" style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:32px;font-weight:800;color:#f59e0b;">${report.flaky}</div>
<div style="font-size:12px;color:#6b7280;font-weight:500;">FLAKY</div>
</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 24px 20px;">
<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="display:flex;justify-content:space-between;margin-bottom:8px;">
<span style="font-size:13px;font-weight:600;color:#374151;">Pass Rate</span>
<span style="font-size:13px;font-weight:700;color:${statusColor};">${report.passRate}%</span>
</div>
<div style="background:#e5e7eb;border-radius:999px;height:10px;">
<div style="background:${statusColor};width:${report.passRate}%;height:100%;border-radius:999px;"></div>
</div>
<div style="margin-top:8px;font-size:11px;color:#9ca3af;">Duration: ${duration} &nbsp;|&nbsp; ${report.skipped} skipped</div>
</div>
</td></tr>
<tr><td style="padding:0 24px 20px;">
<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f3f4f6;">📋 Build Information</div>
<table width="100%" cellpadding="0" cellspacing="0">
${this.row('Start Time', startTime)}
${this.row('End Time', endTime)}
${this.row('Environment', env.toUpperCase())}
${this.row('Branch', branch)}
${this.row('Git Commit', shortCommit)}
${this.row('Triggered By', triggeredBy)}
${this.row('Build Number', '#' + buildNumber)}
${buildUrl ? this.rowLink('Build URL', buildUrl, 'View Build →') : ''}
</table>
</div>
</td></tr>
${report.failedTests.length > 0 ? `
<tr><td style="padding:0 24px 20px;">
<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #fee2e2;">❌ Failed Tests (${report.failedTests.length})</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="background:#fef2f2;">
<th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Test Name</th>
<th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">File</th>
<th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Error</th>
</tr>
${failedRows}
</table>
</div>
</td></tr>` : ''}
${report.flakyTests.length > 0 ? `
<tr><td style="padding:0 24px 20px;">
<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #fef3c7;">⚠️ Flaky Tests (${report.flakyTests.length})</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr style="background:#fffbeb;">
<th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Test Name</th>
<th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">File</th>
<th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">Info</th>
</tr>
${flakyRows}
</table>
</div>
</td></tr>` : ''}
<tr><td style="padding:0 24px 32px;text-align:center;">
<div style="font-size:12px;color:#9ca3af;">Sent by Kylas QA Automation System &nbsp;·&nbsp; qa.kylas@zohomail.in</div>
</td></tr>
</table></td></tr></table>
</body></html>`;
  }

  private row(label: string, value: string): string {
    return `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;">${label}</td><td style="padding:6px 0;font-size:13px;color:#111827;font-weight:500;">${this.esc(value)}</td></tr>`;
  }

  private rowLink(label: string, url: string, text: string): string {
    return `<tr><td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;">${label}</td><td style="padding:6px 0;"><a href="${url}" style="color:#4f46e5;font-size:13px;">${text}</a></td></tr>`;
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
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}
