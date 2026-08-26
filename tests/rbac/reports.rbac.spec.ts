import { Page } from '@playwright/test';
import { test, expect } from '../../src/fixtures/index';
import { ReportsPage } from '../../src/modules/reports/ReportsPage';
import {
  generateAdminReportData,
  generateRestrictedReportData,
  ReportEntityType,
} from '../../src/data/factories/reportFactory';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../src/data/factories/leadFactory';
import { DealsPage } from '../../src/modules/deals/DealsPage';
import { generateDealData } from '../../src/data/factories/dealFactory';
import { ContactsPage } from '../../src/modules/contacts/ContactsPage';
import { generateContactData } from '../../src/data/factories/contactFactory';
import { CompaniesPage } from '../../src/modules/companies/CompaniesPage';
import { generateCompanyData } from '../../src/data/factories/companyFactory';
import { TasksPage } from '../../src/modules/tasks/TasksPage';
import { generateTaskData } from '../../src/data/factories/taskFactory';
import { MeetingsPage } from '../../src/modules/meetings/MeetingsPage';
import { generateMeetingData } from '../../src/data/factories/meetingFactory';
import { QuotationsPage } from '../../src/modules/quotations/QuotationsPage';
import { generateQuotationData } from '../../src/data/factories/quotationFactory';
import { CallLogsPage } from '../../src/modules/call-logs/CallLogsPage';
import { generateCallLogData } from '../../src/data/factories/callLogFactory';
import { config } from '../../config/config';
import { logger } from '../../src/utils/logger';

// WHY label prefix 'R', continuing from reports.spec.ts's R1-R37 — see that
// file's own comment for why this module shares one continuous numbering
// space across both files from the start (.claude/architecture.md §13).
test.describe('Reports RBAC', () => {
  // WHY duplicated here rather than imported from reports.spec.ts: this
  // codebase's own convention keeps UI and RBAC spec files independent,
  // each importing what it needs directly (e.g. leads.spec.ts/
  // leads.rbac.spec.ts never share helper functions) — mirrors that
  // convention rather than introducing a new cross-spec-file dependency.
  function buildEntityCreators(page: Page): Record<ReportEntityType, () => Promise<void>> {
    const leadsPage = new LeadsPage(page);
    const dealsPage = new DealsPage(page);
    const contactsPage = new ContactsPage(page);
    const companiesPage = new CompaniesPage(page);
    const tasksPage = new TasksPage(page);
    const meetingsPage = new MeetingsPage(page);
    const quotationsPage = new QuotationsPage(page);
    const callLogsPage = new CallLogsPage(page);
    return {
      Lead: async () => {
        await leadsPage.goToLeadsList();
        await leadsPage.createLead(generateLeadData());
      },
      Deal: async () => {
        await dealsPage.goToDealsList();
        await dealsPage.createDeal(generateDealData());
      },
      Contact: async () => {
        await contactsPage.goToContactsList();
        await contactsPage.createContact(generateContactData());
      },
      Company: async () => {
        await companiesPage.goToCompaniesList();
        await companiesPage.createCompany(generateCompanyData());
      },
      Task: async () => {
        await tasksPage.goToTasksList();
        await tasksPage.openQuickTaskForm();
        await tasksPage.fillQuickTaskForm(generateTaskData());
        await tasksPage.saveQuickTask();
      },
      Meeting: async () => {
        await meetingsPage.goToMeetingsList();
        await meetingsPage.createMeeting(generateMeetingData());
      },
      Quotation: async () => {
        await quotationsPage.goToQuotationsList();
        await quotationsPage.createQuotation(generateQuotationData());
      },
      'Call log': async () => {
        await callLogsPage.createCallLog(generateCallLogData());
      },
    };
  }

  test('@regression restricted should create a report for lead entity', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const reportData = generateRestrictedReportData({ reportType: 'Lead' });

    const { id, name } = await reportsPage.createReport(reportData);
    await reportsPage.assertReportSaved(id);
    await reportsPage.assertReportVisibleInList(name);
    logger.success('R38 passed');
  });

  // WHY split into 8 independent test() blocks, one per entity type, same
  // as reports.spec.ts's R4-R11 — an explicit correction applied
  // identically to the restricted-user side: each entity type gets its own
  // title, its own independent pass/fail, and its own timing.
  // `windowStart` is captured once for the whole block (see R4-R11's own
  // comment in reports.spec.ts for the full reasoning behind why a shared
  // start with a per-test end is correctly scoped, not a weakening).
  // Everything here runs as the RESTRICTED user throughout — their own
  // created records, their own report, their own API query using their
  // own session/auth (verifyRunCountForEntity() reads the token from
  // whichever page it's given, so passing `restrictedPage`'s own
  // ReportsPage instance is what scopes the whole check to their data).
  //
  // WHY a plain `test.describe()`, not `.serial` (changed 2026-08-21 — see
  // reports.spec.ts's identical comment for the full evidence): `.serial`
  // aborts every remaining test in the block on the first failure, which
  // defeats the entire point of having 8 independently-reported entity-type
  // tests. Plain `test.describe()` still preserves declaration-order
  // execution within a single worker (this suite always runs
  // `--workers=1`), and `beforeAll()` still runs exactly once per describe
  // block either way — the shared `windowStart` mechanism is unaffected.
  test.describe('restricted run-count verification per entity type', () => {
    let windowStart: Date;

    test.beforeAll(() => {
      windowStart = new Date();
    });

    test('@regression restricted should verify lead report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Lead();
      await creators.Lead();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Lead', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Lead: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Lead: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R39 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression restricted should verify deal report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Deal();
      await creators.Deal();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Deal', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Deal: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Deal: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R40 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression restricted should verify contact report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Contact();
      await creators.Contact();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Contact', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Contact: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Contact: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R41 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression restricted should verify company report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Company();
      await creators.Company();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Company', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Company: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Company: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R42 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression restricted should verify task report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Task();
      await creators.Task();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Task', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Task: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Task: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R43 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression restricted should verify meeting report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Meeting();
      await creators.Meeting();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Meeting', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Meeting: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Meeting: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R44 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression restricted should verify call log report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators['Call log']();
      await creators['Call log']();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Call log', windowStart, windowEnd, 'restricted');
      expect(
        reportTotal,
        'Call log: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Call log: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R45 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    // WHY `test.skip()` directly on this one individual test, same as
    // reports.spec.ts's own Quotation entry: matches decision #3's given
    // pattern now that Quotation is its own distinct test again.
    test('@regression restricted should verify quotation report count matches actual filtered entity count on own reports', async ({
      restrictedPage,
    }) => {
      test.skip(config.env !== 'qa', 'Quotation reports not yet deployed to stage/prod');
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(restrictedPage);
      const creators = buildEntityCreators(restrictedPage);
      await creators.Quotation();
      await creators.Quotation();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity(
          'Quotation',
          windowStart,
          windowEnd,
          'restricted'
        );
      expect(
        reportTotal,
        'Quotation: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Quotation: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R46 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });
  });

  test('@regression restricted should delete own report and confirm it no longer appears in reports list', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const { id, name } = await reportsPage.createReport(
      generateRestrictedReportData({ reportType: 'Lead' })
    );

    await reportsPage.deleteReport(id);
    await reportsPage.assertReportNotVisibleInList(name);
    logger.success('R47 passed');
  });

  test('@regression restricted should download own report as aggregate-only csv file with correct content', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const reportData = generateRestrictedReportData({ reportType: 'Lead' });
    const { id, name } = await reportsPage.createReport(reportData);
    await reportsPage.goToReportDetails(id);

    const csvContent = await reportsPage.downloadReportCsv();
    expect(csvContent).toContain(name);
    expect(csvContent).toContain('Total');
    logger.success('R48 passed');
  });

  test('@regression restricted should persist report description change after editing and saving own report', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const { id } = await reportsPage.createReport(
      generateRestrictedReportData({ reportType: 'Lead' })
    );
    const newDescription = `R49 restricted edit-flow description ${Date.now()}`;

    await reportsPage.updateReportDescriptionAndSave(id, newDescription);
    await reportsPage.goToReportEdit(id);
    await expect(restrictedPage.locator('#report_21_input_description')).toHaveValue(
      newDescription
    );
    logger.success('R49 passed');
  });

  test('@regression restricted should require report name dimension and metric to save own report', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToCreateReport();
    await restrictedPage.locator('#report_11_input_name').fill('R50-restricted-validation-check');
    await reportsPage.clickSaveButton();
    await reportsPage.assertValidationCarouselContains(['Dimensions is a required field']);
    logger.success('R50 passed');
  });

  test('@regression restricted should find own report in list via search', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const { name } = await reportsPage.createReport(
      generateRestrictedReportData({ reportType: 'Lead' })
    );

    await reportsPage.assertReportVisibleInList(name);
    logger.success('R51 passed');
  });

  test('@regression restricted should complete save as on own report and verify a new report is genuinely created preserving its filter', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    // WHY a filter is included: same reasoning as reports.spec.ts's R29 fix
    // — the title promises Filters are preserved too; nothing was there to
    // preserve without one.
    //
    // WHY this test no longer asserts on `.report__header`
    // .dimension-name`/`.metric-name`: see reports.spec.ts's identical R35
    // fix — confirmed live WITH THE USER that a filter matching zero real
    // records is a legitimate app state (a "no data" screen replaces the
    // header entirely), not a bug, and this test's real job is only to
    // confirm Save As genuinely creates a new, distinct report and
    // preserves its filter — not that the resulting report happens to
    // render data.
    const original = generateRestrictedReportData({
      reportType: 'Lead',
      dimension: 'Source',
      filters: [{ field: 'Last Name', operator: 'Equals', value: 'R52-saveas-filter-check' }],
    });
    const { id } = await reportsPage.createReport(original);

    const saveAsName = `${original.name}-saveas-check-${Date.now()}`;
    const savedAs = await reportsPage.saveReportAs(id, saveAsName);

    expect(
      savedAs.id,
      'Save As should produce a new report id, distinct from the original'
    ).not.toBe(id);

    // WHY checked here, before navigating anywhere else, and WHY the
    // report's own confirmed displayed name (not the saveAsName string this
    // test set) is used for the list search: see reports.spec.ts's
    // identical R35 fix (2026-08-21) — this text lives on the DETAILS page
    // only, and the Reports list's fuzzy per-word backend search can
    // false-positive on unrelated pre-existing reports sharing a common
    // word (this test's own name contains "check"). assertReportVisibleInList()
    // is itself now fixed to verify this SPECIFIC row, not just that the
    // fuzzy search returned something.
    await expect(restrictedPage.getByText('1 filter applied')).toBeVisible();
    const confirmedName = await reportsPage.getReportNameFromDetailPage();
    expect(confirmedName, 'Save As should persist the exact name requested').toBe(saveAsName);
    await reportsPage.assertReportVisibleInList(confirmedName);
    logger.success('R52 passed');
  });

  // WHY MERGED, both directions in ONE test (was originally two separate
  // R3/R7-style cases): both exercise the identical report-LIST visibility
  // scoping mechanism from opposite directions, and both need the same
  // setup (one admin report + one restricted report existing simultaneously)
  // — confirmed live this asymmetry is real, not a guess: restricted's list
  // search for an admin-owned report's name returns zero rows, while
  // admin's list search for a restricted-owned report's name finds it.
  // Neither "mutual privacy" nor "mutual visibility" is correct — only this
  // exact asymmetric shape is.
  test("@regression restricted user should not see admin-owned report in list while admin should see restricted user's report in list", async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminReportsPage = new ReportsPage(adminPage);
    const restrictedReportsPage = new ReportsPage(restrictedPage);

    const adminReport = await adminReportsPage.createReport(
      generateAdminReportData({ reportType: 'Lead' })
    );
    const restrictedReport = await restrictedReportsPage.createReport(
      generateRestrictedReportData({ reportType: 'Lead' })
    );

    await restrictedReportsPage.assertReportNotVisibleInList(adminReport.name);
    await adminReportsPage.assertReportVisibleInList(restrictedReport.name);
    logger.success('R53 passed');
  });

  // WHY a fresh, ADM<timestamp>-prefixed Lead, never a random pre-existing
  // record: CLAUDE.md rule 5 — this is exactly the "genuinely fresh,
  // isolated record" case rule 5 exists for. Confirmed live
  // (investigation-notes-reports.md Edge Case Investigation, Finding 2) that
  // a precise isolating filter gives a decisive yes/no, not just a
  // suggestive aggregate gap that could have other explanations.
  test('@regression restricted user report should show lower aggregate count than admin and should not surface a specific admin-only record via isolating filter', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminReportsPage = new ReportsPage(adminPage);
    const restrictedReportsPage = new ReportsPage(restrictedPage);
    const leadsPage = new LeadsPage(adminPage);

    const isolatingLastName = `ADM${Date.now()}`;
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(generateLeadData({ lastName: isolatingLastName }));

    const adminBroadReport = generateAdminReportData({ reportType: 'Lead' });
    await adminReportsPage.createReport(adminBroadReport);
    const adminTotal = await adminReportsPage.getReportTotalFromHeader();

    const restrictedBroadReport = generateRestrictedReportData({ reportType: 'Lead' });
    await restrictedReportsPage.createReport(restrictedBroadReport);
    const restrictedTotal = await restrictedReportsPage.getReportTotalFromHeader();

    expect(
      restrictedTotal,
      "Restricted user's own report total should be lower than admin's broad total"
    ).toBeLessThan(adminTotal);

    const isolatingFilterReport = generateRestrictedReportData({
      reportType: 'Lead',
      filters: [{ field: 'Last Name', operator: 'Equals', value: isolatingLastName }],
    });
    await restrictedReportsPage.createReport(isolatingFilterReport);
    await restrictedReportsPage.assertDetailsNoDataMessage();

    // WHY same-filter admin-side control, in the SAME test: proves the
    // empty result above is a genuine access-control outcome, not a broken
    // filter mechanism — confirmed live via the identical methodology.
    const adminControlReport = generateAdminReportData({
      reportType: 'Lead',
      filters: [{ field: 'Last Name', operator: 'Equals', value: isolatingLastName }],
    });
    await adminReportsPage.createReport(adminControlReport);
    await adminReportsPage.assertMetricTotal(1);
    logger.success('R54 passed');
  });

  // WHY this is framed as "does the SAME report show correctly-scoped data
  // no matter who opens it," never "does report X leak data because of who
  // created it" — decision #10's own explicit correction versus the
  // abandoned prior branch (.claude/prior-reports-branch-investigation.md's
  // §3.3), which never tested this at all. The report here is deliberately
  // created by the RESTRICTED user, not admin — confirmed live
  // (investigation-notes-reports.md §7) that admin CAN open a
  // restricted-owned report (the asymmetric visibility R53 already proves),
  // which is what makes "the same report, two viewers" actually
  // constructible; the reverse (admin's PRIVATE report opened by restricted)
  // is blocked entirely at the network layer (R56 below), so there would be
  // no report left to compare data on.
  test('@regression same report should show different aggregate data depending on whether admin or restricted user is viewing it', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const restrictedReportsPage = new ReportsPage(restrictedPage);
    const adminReportsPage = new ReportsPage(adminPage);

    const reportData = generateRestrictedReportData({ reportType: 'Lead' });
    const { id } = await restrictedReportsPage.createReport(reportData);
    const totalAsRestricted = await restrictedReportsPage.getReportTotalFromHeader();

    await adminReportsPage.goToReportDetails(id);
    const totalAsAdmin = await adminReportsPage.getReportTotalFromHeader();

    expect(
      totalAsAdmin,
      'The identical report object must show DIFFERENT totals for admin vs. restricted — data is ' +
        "scoped per-viewer at view-time, not fixed by the creator's access at save-time"
    ).not.toBe(totalAsRestricted);
    logger.success('R55 passed');
  });

  test('@regression restricted user should be blocked with not-found response when directly accessing admin-owned report details url', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminReportsPage = new ReportsPage(adminPage);
    const restrictedReportsPage = new ReportsPage(restrictedPage);

    const { id } = await adminReportsPage.createReport(
      generateAdminReportData({ reportType: 'Lead' })
    );
    await restrictedReportsPage.assertReportNotFoundDirectAccess(id);
    logger.success('R56 passed');
  });

  test('@regression restricted should not be able to duplicate an already-used field across dimensions and filters on own report', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.addDimensionRow();
    await reportsPage.assertOptionExcludedFromDimensionMenu(1, 'Owner');
    logger.success('R57 passed');
  });

  test('@regression restricted should throw and recover from the same client error as admin when removing an empty dimension row', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.addDimensionRow();

    const { appErrorCaptured } = await reportsPage.removeDimensionRow(1);
    expect(
      appErrorCaptured,
      'Confirmed role-independent Kylas app bug — same TypeError as admin'
    ).toBe(true);
    logger.success('R58 passed');
  });

  test('@regression restricted should experience the same stale preview behavior as admin after removing a filter', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.selectMetric(0, 'Number of Leads');
    await reportsPage.addFilter('Last Name', 'Equals', 'R59-restricted-stale-preview-zzz');
    await reportsPage.clickGeneratePreview();
    await reportsPage.assertPreviewNoDataMessage();

    await reportsPage.removeFilterRow(0);
    await reportsPage.assertPreviewNoDataMessage();
    logger.success('R59 passed');
  });

  test('@regression restricted should experience the same sort bug on report name column as admin', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToReportsList();

    const createdAtResponse = await reportsPage.clickListColumnSort('Created At');
    expect(createdAtResponse).not.toBeNull();
    const reportNameResponse = await reportsPage.clickListColumnSort('Report Name');
    expect(reportNameResponse).toBeNull();
    logger.success('R60 passed');
  });

  test('@regression restricted should experience the same zero-data messaging as admin when filter matches no records', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const reportData = generateRestrictedReportData({
      reportType: 'Lead',
      filters: [
        { field: 'Last Name', operator: 'Equals', value: 'ZZZNOTHINGMATCHESRESTRICTED999999' },
      ],
    });
    await reportsPage.goToCreateReport();
    await reportsPage.fillReportForm(reportData);
    await reportsPage.clickGeneratePreview();
    await reportsPage.assertPreviewNoDataMessage();

    await reportsPage.clickSaveButton();
    await reportsPage.assertDetailsNoDataMessage();
    logger.success('R61 passed');
  });

  test('@regression restricted should experience the same multi dimensional unlock behavior as admin', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToCreateReport();
    await reportsPage.assertAddDimensionLinkHidden();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.assertAddDimensionLinkVisible();
    logger.success('R62 passed');
  });

  test('@regression restricted should experience the same custom date range validation and rejection behavior as admin', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.selectMetric(0, 'Number of Leads');
    await reportsPage.selectDateRangeOption('Custom');

    // WHY day 15, not the 1st: same fix as reports.spec.ts's R10 — keeps
    // "the day before start" inside the same visible calendar month.
    const start = new Date();
    start.setDate(15);
    const dayBeforeStart = new Date(start);
    dayBeforeStart.setDate(dayBeforeStart.getDate() - 1);
    const validLaterDate = new Date(start);
    validLaterDate.setDate(validLaterDate.getDate() + 5);
    await reportsPage.fillCustomDateRange(start, validLaterDate);
    await reportsPage.assertEndDateBlockedBefore(dayBeforeStart);

    const now = new Date();
    const sixYearsAgo = new Date(now);
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    await reportsPage.fillCustomDateRange(sixYearsAgo, now);
    await reportsPage.clickGeneratePreview();
    await reportsPage.assertBackendRangeRejection();
    logger.success('R63 passed');
  });

  test("@regression restricted should verify entity deletion affects own report count the same way as admin's", async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);

    // WHY a uniquely-tagged Last Name + filtered report: shares the exact
    // root cause and fix as reports.spec.ts's R36 — see that test's own WHY
    // comment and .claude/known-issues.md's Sandbox Build #147 investigation
    // (revised 2026-08-25) for the full evidence. Not independently
    // re-investigated as a separate root cause since it's byte-identical.
    const uniqueLastName = `R64-delete-check-${Date.now()}`;
    const windowStart = new Date();
    const leadData = generateLeadData({ lastName: uniqueLastName });
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    const windowEnd = new Date();

    const { reportId, reportTotal: beforeTotal } = await reportsPage.verifyRunCountForEntity(
      'Lead',
      windowStart,
      windowEnd,
      'restricted',
      [{ field: 'Last Name', operator: 'Equals', value: uniqueLastName }]
    );
    expect(beforeTotal).toBeGreaterThan(0);

    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();

    const afterTotal = await reportsPage.waitForReportTotalBelow(reportId, beforeTotal, 'Lead');
    expect(afterTotal).toBeLessThan(beforeTotal);
    logger.success('R64 passed');
  });
});
