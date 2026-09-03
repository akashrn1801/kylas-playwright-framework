import { test, expect } from '../../../src/fixtures/index';
import { DashboardPage, DEFAULT_DASHBOARD_SECTIONS } from '../../../src/modules/dashboard/DashboardPage';
import {
  generateDashboardData,
  REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE,
} from '../../../src/data/factories/dashboardFactory';
import { ReportsPage } from '../../../src/modules/reports/ReportsPage';
import { generateReportData } from '../../../src/data/factories/reportFactory';
import { logger } from '../../../src/utils/logger';

// WHY label prefix 'DB' — the first label assigned to this brand-new module,
// per .claude/architecture.md §13's per-module letter-prefix convention (a
// grep of every existing logger.success('<PREFIX>N passed') call across the
// whole test suite confirmed 'DB' is not already in use). UI (DB1-DB15,
// DB29-DB45) and RBAC (DB16-DB28, DB46-DB62) share one continuous numbering
// space from the start, mirroring Reports' own R1-R64 convention.
//
// WHY every dashlet-adding test below targets a disposable custom dashboard
// created fresh by the test itself, NEVER Default Dashboard/Productivity
// Dashboard: build guardrail — those two shared dashboards have a live,
// reproduced stuck-dashlet SYMPTOM where Report-type dashlets can get
// permanently stuck loading with no way to remove them via the UI (root
// cause never established — see `.claude/known-issues.md`'s Dashboard
// section). Tests 2-6, which DO run against Default Dashboard, only ever
// collapse/expand sections or enter-then-cancel edit mode — never add or
// save a dashlet there.
test.describe('Dashboard', () => {
  test('@smoke @prodSafe DB1 default sections + dashlets visible on load', async ({ adminPage }) => {
    const dashboardPage = new DashboardPage(adminPage);
    await dashboardPage.goToDashboard();
    await dashboardPage.assertDefaultSectionsVisible();
    for (const section of DEFAULT_DASHBOARD_SECTIONS) {
      await dashboardPage.assertSectionHasDashlets(section.label);
    }
    logger.success('DB1 passed');
  });

  test('@smoke @regression DB2 collapse each default section', async ({ adminPage }) => {
    const dashboardPage = new DashboardPage(adminPage);
    await dashboardPage.goToDashboard();
    try {
      for (const section of DEFAULT_DASHBOARD_SECTIONS) {
        // WHY explicitly expanded FIRST, not assumed: `collapseSection()`
        // is a guarded, idempotent "ensure collapsed" helper — if a section
        // is already collapsed (e.g. leftover state from an earlier test
        // run), it silently no-ops, and the very next assertion would
        // trivially pass without this test ever having exercised a real
        // collapse action. A real, confirmed gap (found via live headed
        // observation, 2026-09-02) — only "Leads" was visibly toggling in
        // a run where the other 4 sections happened to already be
        // collapsed from prior runs. Establishing a known starting state
        // makes every iteration genuinely test the collapse transition,
        // not just read whatever state happened to already be there.
        await dashboardPage.expandSection(section.sectionId);
        await dashboardPage.collapseSection(section.sectionId);
        expect(await dashboardPage.isSectionExpanded(section.sectionId)).toBe(false);
      }
    } finally {
      // WHY restored regardless of assertion outcome: collapse state is
      // confirmed account-persisted (§2B), not session-scoped — leaving
      // every default section collapsed would pollute this account's real
      // state for every subsequent test/human session.
      for (const section of DEFAULT_DASHBOARD_SECTIONS) {
        await dashboardPage.expandSection(section.sectionId);
      }
    }
    logger.success('DB2 passed');
  });

  // WHY there is no DB3 here (removed 2026-09-02, not renumbered): a
  // dedicated "expand a collapsed section back" test existed here, asserting
  // `expandSection()` in isolation. It failed intermittently, including on
  // the very first attempt of a dedicated 5-run isolated re-verification
  // (`--retries=0`, confirmed no other QA-touching activity running
  // concurrently) — disproving the leading hypothesis that earlier failures
  // were a concurrent-session artifact. Per explicit direction, this
  // coverage was removed rather than debugged further (not essential enough
  // to justify continued investigation) — see `.claude/known-issues.md`'s
  // Dashboard section for the full evidence and final disposition.
  // `expandSection()` itself is NOT dead code and remains exercised
  // (required to succeed, not just called) by DB2's and DB4's own setup/
  // cleanup steps below — this removal drops the one DEDICATED, isolated
  // assertion of expand-after-collapse, not all exercise of the method.
  // The gap in numbering (DB2 → DB4) is intentional, matching this
  // codebase's own convention of never reusing a removed/renumbered test ID.

  test('@regression DB4 collapse state survives a full page reload', async ({ adminPage }) => {
    const dashboardPage = new DashboardPage(adminPage);
    await dashboardPage.goToDashboard();
    const section = DEFAULT_DASHBOARD_SECTIONS[0];
    try {
      // WHY expanded first: see DB2's identical WHY comment above.
      await dashboardPage.expandSection(section.sectionId);
      await dashboardPage.collapseSection(section.sectionId);
      await dashboardPage.reloadPage();
      await dashboardPage.assertDashboardLoaded();
      expect(await dashboardPage.isSectionExpanded(section.sectionId)).toBe(false);
    } finally {
      await dashboardPage.expandSection(section.sectionId);
    }
    logger.success('DB4 passed');
  });

  test('@regression DB5 edit mode disables collapse/expand', async ({ adminPage }) => {
    const dashboardPage = new DashboardPage(adminPage);
    await dashboardPage.goToDashboard();
    const section = DEFAULT_DASHBOARD_SECTIONS[0];
    await dashboardPage.enterEditMode();
    try {
      await dashboardPage.assertCollapseDisabledInEditMode(section.sectionId);
    } finally {
      // WHY discard, never Save: this test must never persist any change to
      // Default Dashboard (build guardrail).
      await dashboardPage.cancelEditModeAndDiscard();
    }
    logger.success('DB5 passed');
  });

  test('@regression DB6 cancel always shows Discard modal, even with zero changes', async ({ adminPage }) => {
    const dashboardPage = new DashboardPage(adminPage);
    await dashboardPage.goToDashboard();
    await dashboardPage.enterEditMode();
    // No changes made at all — confirmed live (§2C/§4 item 3) the Discard
    // modal appears regardless.
    await dashboardPage.cancelEditModeAndKeepEditing();
    expect(await dashboardPage.isInEditMode()).toBe(true);
    await dashboardPage.cancelEditModeAndDiscard();
    expect(await dashboardPage.isInEditMode()).toBe(false);
    logger.success('DB6 passed');
  });

  test('@regression DB7 add new empty dashboard, verify empty state, persists after Save + reload', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.openCreateNewDashboardForm();
      await dashboardPage.renameDashboard(data.name);
      await dashboardPage.assertEmptyState();
      await dashboardPage.saveDashboard();
      expect(await dashboardPage.getCurrentDashboardName()).toBe(data.name);
      // WHY re-select from the switcher after reload, never just reload and
      // check the current view: a fresh load always lands back on the
      // account's PRIMARY dashboard (§4 item 5), not whichever was last
      // viewed — folds in what was originally a separate "persists after
      // reload" test, per this build's finalized scope.
      await dashboardPage.assertDashboardActiveAfterReload(data.name);
    } finally {
      // WHY `.catch()`, not a bare await: a JS `finally` block's own thrown
      // error REPLACES whatever the `try` block already threw — an
      // unguarded teardown failure here would silently overwrite and hide
      // the real assertion failure that actually caused this test to fail
      // (confirmed real during this build's own QA verification run, where
      // a DB20/DB21 wizard failure's real cause was briefly masked this
      // exact way before DashboardPage.getCurrentDashboardName() itself was
      // given an explicit timeout).
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB7 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB7 passed');
  });

  // WHY DB8 (a single test covering all 17 type/entity combinations in one
  // continuous flow) was replaced with 17 individual tests below
  // (DB29-DB45, restructured 2026-09-02): the original single-test design
  // hid each combination's own independent pass/fail behind one shared
  // result — a failure partway through (e.g. on the 9th of 17 adds) silently
  // aborted every remaining combination with no separate signal for any of
  // them. Split into one test() per combination so each gets its own
  // independent pass/fail signal.
  //
  // WHY each of these 17 now creates and deletes its OWN disposable
  // dashboard (reverted 2026-09-02 from an intermediate shared-dashboard-via-
  // `beforeAll`/`afterAll` design, matching the exact same disposable-per-
  // test pattern DB7/DB9/DB10/DB11/DB12/DB13/DB14 already use): the shared-
  // dashboard version was tried first specifically to avoid multiplying this
  // suite's real QA-environment load 17x, but a dedicated investigation
  // found it was fundamentally unsound — this repo's `playwright.config.ts`
  // sets `fullyParallel: true`, and Playwright does NOT guarantee a
  // `beforeAll`/`afterAll` pair runs exactly once for a whole describe block
  // under that setting. Confirmed live: a real full-block run showed
  // `afterAll` (deleting the shared dashboard) firing immediately after a
  // single in-group test failure, followed by a BRAND NEW `beforeAll`
  // (creating a fresh dashboard) for the remaining tests — THREE separate
  // dashboards existed across one 17-test run, not one, silently violating
  // the whole design's own "one shared dashboard" premise the moment any
  // failure occurred. Two fixes were weighed (see `.claude/known-issues.md`'s
  // Dashboard section for the full tradeoffs writeup): forcing
  // `test.describe.configure({mode:'serial'})` would have restored the "one
  // dashboard" guarantee, but this codebase already has a directly-relevant,
  // confirmed precedent for why that's worse here — Reports' own run-count
  // verification tests tried `.serial` and reverted it after one failure
  // silently skip-cascaded every remaining test in the block, defeating the
  // exact "one failure shouldn't hide another's signal" goal this whole
  // DB8-to-34-tests split exists for. Reverting to a disposable dashboard
  // per test (this version) costs more QA load (~2-3 extra minutes total,
  // 34 more create/delete calls per full run) but is a complete, genuine fix
  // — no shared state left to fragment, and every test's pass/fail stays
  // fully independent, matching every other individual test in this file.
  //
  // WHY each Report-type test (DB39-DB45) still creates and deletes its OWN
  // single disposable Report inline: unchanged from the original design
  // (build decision #2) — keeps every Report test fully self-contained.
  //
  // WHY the render-race noted in DashboardPage.addDashlet()'s own comment
  // (a rapid-succession dashlet add occasionally not rendering) was
  // explicitly OUT OF SCOPE here: a dedicated root-cause investigation (see
  // `.claude/known-issues.md`'s Dashboard section) found and fixed one real
  // contributing test-side defect, but the render-race itself remains open —
  // if a specific entity/type combination hits it, that specific test fails
  // on its own with a clear, attributable message, which is itself useful
  // diagnostic information this split is intended to surface, not mask.
  // (DB3's own expand-after-collapse investigation, also out of scope at the
  // time this comment was originally written, was later resolved by
  // removing that test — see its own removal note above and
  // `.claude/known-issues.md`'s Dashboard section.)

  // ── Smartlist × 5 entities ──
  test('@regression DB29 add Smartlist dashlet for Lead', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'lead');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB29 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB29 passed');
  });

  test('@regression DB30 add Smartlist dashlet for Deal', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'deal');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB30 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB30 passed');
  });

  test('@regression DB31 add Smartlist dashlet for Contact', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'contact');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB31 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB31 passed');
  });

  test('@regression DB32 add Smartlist dashlet for Company', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'company');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB32 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB32 passed');
  });

  test('@regression DB33 add Smartlist dashlet for Email', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'email');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB33 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB33 passed');
  });

  // ── Grouped Smartlists (multilist) × 5 entities ──
  test('@regression DB34 add Grouped Smartlists dashlet for Lead', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('multilist', 'lead');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB34 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB34 passed');
  });

  test('@regression DB35 add Grouped Smartlists dashlet for Deal', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('multilist', 'deal');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB35 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB35 passed');
  });

  test('@regression DB36 add Grouped Smartlists dashlet for Contact', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('multilist', 'contact');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB36 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB36 passed');
  });

  test('@regression DB37 add Grouped Smartlists dashlet for Company', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('multilist', 'company');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB37 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB37 passed');
  });

  test('@regression DB38 add Grouped Smartlists dashlet for Email', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('multilist', 'email');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB38 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB38 passed');
  });

  // ── Report × 7 entities — each creates + cleans up its own disposable
  // Report AND its own disposable dashboard (build decision #2, applied at
  // per-test granularity) ──
  test('@regression DB39 add Report dashlet for Lead', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.lead });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'lead', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB39 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB39 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB39 passed');
  });

  test('@regression DB40 add Report dashlet for Deal', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.deal });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'deal', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB40 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB40 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB40 passed');
  });

  test('@regression DB41 add Report dashlet for Contact', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.contact });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'contact', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB41 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB41 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB41 passed');
  });

  test('@regression DB42 add Report dashlet for Company', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.company });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'company', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB42 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB42 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB42 passed');
  });

  test('@regression DB43 add Report dashlet for Task', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.task });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'task', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB43 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB43 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB43 passed');
  });

  test('@regression DB44 add Report dashlet for Meeting', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.meeting });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'meeting', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB44 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB44 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB44 passed');
  });

  test('@regression DB45 add Report dashlet for Call Log', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const reportsPage = new ReportsPage(adminPage);
    const data = generateDashboardData();
    const reportData = generateReportData({ reportType: REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE.call });
    const { id: reportId, name: reportName } = await reportsPage.createReport(reportData);
    try {
      await dashboardPage.goToDashboard();
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('report', 'call', reportName);
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB45 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB45 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB45 passed');
  });

  test('@regression DB9 add a dashlet to an EXISTING dashboard via the same flow', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'lead');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      // WHY `.catch()`: see DB7's own comment above.
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB9 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB9 passed');
  });

  test('@regression DB10 create a disposable dashboard, delete it, confirm gone after reload', async ({
    adminPage,
  }) => {
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    await dashboardPage.createDashboard(data);
    try {
      await dashboardPage.deleteDashboardByName(data.name);
      await dashboardPage.reloadPage();
      await dashboardPage.assertDashboardLoaded();
      await dashboardPage.assertDashboardNotInSwitcher(data.name);
    } finally {
      // WHY a best-effort catch-all here even though deletion IS the
      // behavior under test: if the real assertion (assertDashboardNotInSwitcher)
      // is what throws, the dashboard was already deleted and this is a
      // guaranteed no-op; if deleteDashboardByName() itself is what throws,
      // this is what prevents the disposable dashboard from being silently
      // orphaned (flaky-test-auditor finding, 2026-09-02).
      await dashboardPage.deleteDashboardByName(data.name).catch(() => {});
    }
    logger.success('DB10 passed');
  });

  test('@regression DB11 remove a dashlet in edit mode, Cancel instead of Save, confirm restored', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'lead');
      await dashboardPage.saveDashboard();

      // The actual removal-then-cancel flow under test.
      await dashboardPage.enterEditMode();
      await dashboardPage.removeDashletByTitle(title);
      await dashboardPage.cancelEditModeAndDiscard();
      await dashboardPage.reloadPage();
      await dashboardPage.switchToDashboard(data.name);
      await dashboardPage.assertDashletVisible(title);
    } finally {
      // WHY `.catch()`: see DB7's own comment above.
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB11 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB11 passed');
  });

  test('@regression DB12 rename a dashboard, confirm it persists', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    const renamed = generateDashboardData().name;
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      await dashboardPage.renameDashboard(renamed);
      await dashboardPage.saveDashboard();
      expect(await dashboardPage.getCurrentDashboardName()).toBe(renamed);
      await dashboardPage.assertDashboardActiveAfterReload(renamed);
    } finally {
      // WHY `.catch()`: see DB7's own comment above.
      await dashboardPage.deleteDashboardByName(renamed).catch((error) => {
        logger.warn(`DB12 teardown: failed to delete dashboard "${renamed}": ${String(error)}`);
      });
    }
    logger.success('DB12 passed');
  });

  test('@regression DB13 switch between multiple dashboards', async ({ adminPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const dataA = generateDashboardData();
    const dataB = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(dataA);
      await dashboardPage.enterEditMode();
      const titleA = await dashboardPage.addDashlet('smartlist', 'lead');
      await dashboardPage.saveDashboard();

      await dashboardPage.createDashboard(dataB);
      await dashboardPage.enterEditMode();
      const titleB = await dashboardPage.addDashlet('smartlist', 'deal');
      await dashboardPage.saveDashboard();

      await dashboardPage.switchToDashboard(dataA.name);
      await dashboardPage.assertDashletVisible(titleA);
      await dashboardPage.switchToDashboard(dataB.name);
      await dashboardPage.assertDashletVisible(titleB);
    } finally {
      await dashboardPage.deleteDashboardByName(dataA.name).catch((error) => {
        logger.warn(`DB13 teardown: failed to delete dashboard "${dataA.name}": ${String(error)}`);
      });
      await dashboardPage.deleteDashboardByName(dataB.name).catch((error) => {
        logger.warn(`DB13 teardown: failed to delete dashboard "${dataB.name}": ${String(error)}`);
      });
    }
    logger.success('DB13 passed');
  });

  test('@regression DB14 mark a dashboard as Primary, reload, confirm active + option disabled', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(adminPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.markCurrentDashboardAsPrimary();
      // WHY reload alone (no switcher re-selection) is the correct check
      // here, unlike every other "persists after reload" assertion in this
      // file: marking a dashboard Primary is exactly what makes a fresh
      // load land on it (§4 item 5) — reloading and landing on it directly
      // IS the behavior under test.
      await dashboardPage.reloadPage();
      await dashboardPage.assertDashboardLoaded();
      expect(await dashboardPage.getCurrentDashboardName()).toBe(data.name);
      expect(await dashboardPage.isMarkAsPrimaryDisabled()).toBe(true);
    } finally {
      // WHY a single guarded restore call, not 3 independently-`.catch()`'d
      // steps: see DashboardPage.restorePrimaryToDefaultDashboard()'s own
      // WHY comment — a failed switch must never let the mark-as-primary
      // step run anyway against whatever dashboard is still active.
      await dashboardPage.restorePrimaryToDefaultDashboard();
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB14 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB14 passed');
  });

  test('@regression DB15 Call Log has no Smartlist/Grouped Smartlist option (Report-only entity)', async ({
    adminPage,
  }) => {
    const dashboardPage = new DashboardPage(adminPage);
    await dashboardPage.goToDashboard();
    // WHY a never-saved new-dashboard form, discarded at the end: this is a
    // pure, read-only wizard inspection — no dashlet is ever added, and
    // discarding an unsaved dashboard leaves zero residue (no delete needed).
    await dashboardPage.openCreateNewDashboardForm();
    try {
      await dashboardPage.openAddDashletWizard();
      await dashboardPage.assertEntityTypeNotOfferedForDashletType('smartlist', 'call');
      await dashboardPage.assertEntityTypeNotOfferedForDashletType('multilist', 'call');
      await dashboardPage.closeWizardWithoutAdding();
    } finally {
      await dashboardPage.cancelEditModeAndDiscard();
    }
    logger.success('DB15 passed');
  });
});
