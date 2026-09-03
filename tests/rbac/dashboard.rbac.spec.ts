import { test, expect } from '../../src/fixtures/index';
import { DashboardPage } from '../../src/modules/dashboard/DashboardPage';
import {
  generateDashboardData,
  generateAdminDashboardData,
  REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE,
  RESTRICTED_USER_PROFILE_NAME,
} from '../../src/data/factories/dashboardFactory';
import { ReportsPage } from '../../src/modules/reports/ReportsPage';
import { generateReportData } from '../../src/data/factories/reportFactory';
import { logger } from '../../src/utils/logger';

// WHY label prefix 'DB', continuing from dashboard.spec.ts's DB1-DB15 — see
// that file's own comment for why this module shares one continuous
// numbering space across both files from the start (mirrors Reports'
// R1-R64 precedent).
test.describe('Dashboard RBAC', () => {
  test('@smoke @prodSafe DB16 restricted user can view dashboard', async ({ restrictedPage }) => {
    const dashboardPage = new DashboardPage(restrictedPage);
    await dashboardPage.goToDashboard();
    await dashboardPage.assertDefaultSectionsVisible();
    logger.success('DB16 passed');
  });

  test('@regression DB17 restricted user has no Edit option on Default Dashboard', async ({
    restrictedPage,
  }) => {
    const dashboardPage = new DashboardPage(restrictedPage);
    await dashboardPage.goToDashboard();
    expect(await dashboardPage.hasEditOptionInGearMenu()).toBe(false);
    // WHY also asserted here, not just "no Edit": confirmed live (§2F) the
    // restricted user's gear menu on Default Dashboard has exactly ONE item
    // — the (disabled) Mark as Primary — not an empty menu.
    expect(await dashboardPage.isMarkAsPrimaryDisabled()).toBe(true);
    logger.success('DB17 passed');
  });

  test('@regression DB18 restricted user can create their own custom dashboard', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      expect(await dashboardPage.getCurrentDashboardName()).toBe(data.name);
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
        logger.warn(`DB18 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB18 passed');
  });

  test("@regression DB19 restricted user's gear menu on own dashboard has full option set", async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      const items = await dashboardPage.getGearMenuItemTexts();
      // WHY a Set-based comparison, not an exact-order array match: confirmed
      // live (§2F) the 4 items — Edit / Mark as Primary / Delete / Assign
      // Dashboard — are all present on a restricted user's OWN custom
      // dashboard, symmetric with admin; DOM order isn't a documented
      // contract worth pinning a test to.
      expect(new Set(items)).toEqual(new Set(['Edit', 'Mark as Primary', 'Delete', 'Assign Dashboard']));
    } finally {
      // WHY `.catch()`: see DB18's own comment above.
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB19 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB19 passed');
  });

  // WHY DB20 was replaced with 17 individual tests below (DB46-DB62,
  // restructured 2026-09-02, then reverted from a shared-dashboard-via-
  // `beforeAll`/`afterAll` design to disposable-per-test dashboards on the
  // same date): see dashboard.spec.ts's identical DB29-DB45 block for the
  // full reasoning (split rationale, the confirmed `fullyParallel: true`
  // fragmentation bug that made the shared-dashboard version unsound, why
  // `.serial` mode was rejected using this codebase's own Reports precedent,
  // why each test self-identifies its own dashlet by name, why the
  // still-open render-race is out of scope, and DB3's own now-resolved-via-
  // removal expand-after-collapse investigation) — not repeated verbatim
  // here to avoid drift between two copies of the same explanation; this
  // file's own version differs only in using the restricted role and this
  // test's own disposable Reports (the Report-dashlet picker lists "your own
  // already-saved Reports", §2E — a restricted user's own reports are the
  // only ones guaranteed accessible to them).

  // ── Smartlist × 5 entities ──
  test('@regression DB46 restricted user: add Smartlist dashlet for Lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB46 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB46 passed');
  });

  test('@regression DB47 restricted user: add Smartlist dashlet for Deal', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB47 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB47 passed');
  });

  test('@regression DB48 restricted user: add Smartlist dashlet for Contact', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB48 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB48 passed');
  });

  test('@regression DB49 restricted user: add Smartlist dashlet for Company', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB49 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB49 passed');
  });

  test('@regression DB50 restricted user: add Smartlist dashlet for Email', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB50 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB50 passed');
  });

  // ── Grouped Smartlists (multilist) × 5 entities ──
  test('@regression DB51 restricted user: add Grouped Smartlists dashlet for Lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB51 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB51 passed');
  });

  test('@regression DB52 restricted user: add Grouped Smartlists dashlet for Deal', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB52 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB52 passed');
  });

  test('@regression DB53 restricted user: add Grouped Smartlists dashlet for Contact', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB53 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB53 passed');
  });

  test('@regression DB54 restricted user: add Grouped Smartlists dashlet for Company', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB54 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB54 passed');
  });

  test('@regression DB55 restricted user: add Grouped Smartlists dashlet for Email', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB55 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB55 passed');
  });

  // ── Report × 7 entities — each creates + cleans up its own disposable
  // Report AND its own disposable dashboard (build decision #2, applied at
  // per-test granularity) ──
  test('@regression DB56 restricted user: add Report dashlet for Lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB56 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB56 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB56 passed');
  });

  test('@regression DB57 restricted user: add Report dashlet for Deal', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB57 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB57 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB57 passed');
  });

  test('@regression DB58 restricted user: add Report dashlet for Contact', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB58 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB58 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB58 passed');
  });

  test('@regression DB59 restricted user: add Report dashlet for Company', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB59 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB59 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB59 passed');
  });

  test('@regression DB60 restricted user: add Report dashlet for Task', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB60 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB60 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB60 passed');
  });

  test('@regression DB61 restricted user: add Report dashlet for Meeting', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB61 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB61 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB61 passed');
  });

  test('@regression DB62 restricted user: add Report dashlet for Call Log', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const reportsPage = new ReportsPage(restrictedPage);
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
        logger.warn(`DB62 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
      await reportsPage.deleteReport(reportId).catch((error) => {
        logger.warn(`DB62 teardown: failed to delete report ${reportId}: ${String(error)}`);
      });
    }
    logger.success('DB62 passed');
  });

  test("@regression DB21 restricted user: add a dashlet to their own EXISTING dashboard", async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'lead');
      await dashboardPage.saveDashboard();
      await dashboardPage.assertDashletVisible(title);
    } finally {
      // WHY `.catch()`: see DB18's own comment above.
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB21 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB21 passed');
  });

  test('@regression DB22 restricted user: create disposable dashboard, delete it, confirm gone after reload', async ({
    restrictedPage,
  }) => {
    const dashboardPage = new DashboardPage(restrictedPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    await dashboardPage.createDashboard(data);
    try {
      await dashboardPage.deleteDashboardByName(data.name);
      await dashboardPage.reloadPage();
      await dashboardPage.assertDashboardLoaded();
      await dashboardPage.assertDashboardNotInSwitcher(data.name);
    } finally {
      // WHY a best-effort catch-all even though deletion IS the behavior
      // under test: see dashboard.spec.ts's DB10 for the identical
      // reasoning — a guaranteed no-op if deletion already succeeded, a
      // real orphan-prevention attempt if it didn't.
      await dashboardPage.deleteDashboardByName(data.name).catch(() => {});
    }
    logger.success('DB22 passed');
  });

  test('@regression DB23 restricted user: remove a dashlet, Cancel instead of Save, confirm restored', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.enterEditMode();
      const title = await dashboardPage.addDashlet('smartlist', 'lead');
      await dashboardPage.saveDashboard();

      await dashboardPage.enterEditMode();
      await dashboardPage.removeDashletByTitle(title);
      await dashboardPage.cancelEditModeAndDiscard();
      await dashboardPage.reloadPage();
      await dashboardPage.switchToDashboard(data.name);
      await dashboardPage.assertDashletVisible(title);
    } finally {
      // WHY `.catch()`: see DB18's own comment above.
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB23 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB23 passed');
  });

  test("@regression DB24 restricted user: rename their own dashboard, confirm it persists", async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
      // WHY `.catch()`: see DB18's own comment above.
      await dashboardPage.deleteDashboardByName(renamed).catch((error) => {
        logger.warn(`DB24 teardown: failed to delete dashboard "${renamed}": ${String(error)}`);
      });
    }
    logger.success('DB24 passed');
  });

  test("@regression DB25 restricted user: switch between their own multiple dashboards", async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
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
        logger.warn(`DB25 teardown: failed to delete dashboard "${dataA.name}": ${String(error)}`);
      });
      await dashboardPage.deleteDashboardByName(dataB.name).catch((error) => {
        logger.warn(`DB25 teardown: failed to delete dashboard "${dataB.name}": ${String(error)}`);
      });
    }
    logger.success('DB25 passed');
  });

  test('@regression DB26 restricted user: mark their own dashboard as Primary, reload, confirm active + disabled', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const dashboardPage = new DashboardPage(restrictedPage);
    const data = generateDashboardData();
    await dashboardPage.goToDashboard();
    try {
      await dashboardPage.createDashboard(data);
      await dashboardPage.markCurrentDashboardAsPrimary();
      await dashboardPage.reloadPage();
      await dashboardPage.assertDashboardLoaded();
      expect(await dashboardPage.getCurrentDashboardName()).toBe(data.name);
      expect(await dashboardPage.isMarkAsPrimaryDisabled()).toBe(true);
    } finally {
      // WHY a single guarded restore call, same reasoning as
      // dashboard.spec.ts's DB14 — see restorePrimaryToDefaultDashboard()'s
      // own WHY comment.
      await dashboardPage.restorePrimaryToDefaultDashboard();
      await dashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB26 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB26 passed');
  });

  // WHY this assigns by PROFILE, not by individual user: confirmed live via
  // a follow-up MCP investigation (2026-09-02) — the Assign Dashboard
  // modal's "Assign to" control only ever offers "Profiles" or "Teams",
  // never "Users" (an earlier, incorrect assumption based on the original
  // investigation's own admittedly-incomplete §6 open question #7). With
  // "Profiles" as its live-confirmed default, the assignee search field
  // enumerated exactly two real profiles: "Admin" and "Restricted User" —
  // RESTRICTED_USER_PROFILE_NAME (dashboardFactory.ts) is that confirmed
  // value, not the restricted user's own display name.
  test("@regression DB27 admin assigns a dashboard to the restricted user's profile, restricted user can see it", async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminDashboardPage = new DashboardPage(adminPage);
    const restrictedDashboardPage = new DashboardPage(restrictedPage);
    const data = generateAdminDashboardData();
    await adminDashboardPage.goToDashboard();
    try {
      await adminDashboardPage.createDashboard(data);
      await adminDashboardPage.assignDashboardToProfile(RESTRICTED_USER_PROFILE_NAME);

      await restrictedDashboardPage.goToDashboard();
      expect(await restrictedDashboardPage.isDashboardInSwitcher(data.name)).toBe(true);
    } finally {
      await adminDashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB27 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB27 passed');
  });

  test("@regression DB28 restricted user cannot see admin's unassigned private dashboards", async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminDashboardPage = new DashboardPage(adminPage);
    const restrictedDashboardPage = new DashboardPage(restrictedPage);
    const data = generateAdminDashboardData();
    await adminDashboardPage.goToDashboard();
    try {
      await adminDashboardPage.createDashboard(data);
      await restrictedDashboardPage.goToDashboard();
      await restrictedDashboardPage.assertDashboardNotInSwitcher(data.name);
    } finally {
      await adminDashboardPage.deleteDashboardByName(data.name).catch((error) => {
        logger.warn(`DB28 teardown: failed to delete dashboard "${data.name}": ${String(error)}`);
      });
    }
    logger.success('DB28 passed');
  });
});
