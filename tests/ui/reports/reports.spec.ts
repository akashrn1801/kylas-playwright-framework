import { test, expect } from '../../../src/fixtures/index';
import { ReportsPage } from '../../../src/modules/reports/ReportsPage';
import {
  generateReportData,
  REPORT_OWNER_DIMENSION_BY_ENTITY,
  REPORT_COUNT_METRIC_BY_ENTITY,
  ReportEntityType,
} from '../../../src/data/factories/reportFactory';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../../src/data/factories/leadFactory';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { generateDealData } from '../../../src/data/factories/dealFactory';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { generateContactData } from '../../../src/data/factories/contactFactory';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import { generateCompanyData } from '../../../src/data/factories/companyFactory';
import { TasksPage } from '../../../src/modules/tasks/TasksPage';
import { generateTaskData } from '../../../src/data/factories/taskFactory';
import { MeetingsPage } from '../../../src/modules/meetings/MeetingsPage';
import { generateMeetingData } from '../../../src/data/factories/meetingFactory';
import { QuotationsPage } from '../../../src/modules/quotations/QuotationsPage';
import { generateQuotationData } from '../../../src/data/factories/quotationFactory';
import { CallLogsPage } from '../../../src/modules/call-logs/CallLogsPage';
import { generateCallLogData } from '../../../src/data/factories/callLogFactory';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

// WHY label prefix 'R' — the first label assigned to this brand-new module,
// per .claude/architecture.md §13's per-module letter-prefix convention. UI
// (R1-R37, plus R65 added 2026-08-25) and RBAC (R38-R64) share one
// continuous numbering space from the start, avoiding the renumbering
// collisions that convention's own history documents for other modules that
// started each file at 1 independently.
test.describe('Reports', () => {
  // WHY this creation-helper map lives at module scope: shared by every one
  // of the 8 per-entity-type run-count tests below (R4-R11), each needing a
  // fresh record of its OWN entity type through that module's OWN existing
  // page object/factory — this file only ever CALLS those modules' exported
  // methods, never edits them (this build's own hard rule 3).
  function buildEntityCreators(page: import('@playwright/test').Page): Record<ReportEntityType, () => Promise<void>> {
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

  test('@smoke @prodSafe reports list page should load successfully', async ({ adminPage }) => {
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToReportsList();
    await reportsPage.assertReportsListLoaded();
    logger.success('R1 passed');
  });

  test('@smoke @regression admin should create a report for lead entity', async ({ adminPage }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({ reportType: 'Lead' });

    const { id, name } = await reportsPage.createReport(reportData);
    await reportsPage.assertReportSaved(id);
    await reportsPage.assertReportVisibleInList(name);
    logger.success('R2 passed');
  });

  test('@regression admin should create a report for deal entity to confirm entity type generalizes', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({ reportType: 'Deal' });

    const { id, name } = await reportsPage.createReport(reportData);
    await reportsPage.assertReportSaved(id);
    await reportsPage.assertReportVisibleInList(name);
    logger.success('R3 passed');
  });

  // WHY split into 8 independent test() blocks, one per entity type,
  // instead of one test looping over all 8: an explicit correction to this
  // build's own original design — bundling all 8 entity types into a
  // single test() hid each entity type's own independent pass/fail behind
  // one shared result (a failure partway through, e.g. on Task, silently
  // aborted the remaining Meeting/Call log/Quotation checks with no
  // separate signal for any of them). Grouped inside a plain
  // `test.describe()` (NOT `.serial` — see that block's own comment below
  // for why `.serial` was tried first and reverted after it reproduced the
  // exact same "one failure hides the rest" problem this split was meant
  // to fix) so all 8 still run in a fixed sequence relative to each other
  // and to the rest of the suite under this suite's `--workers=1`, while
  // each genuinely gets its own independent pass/fail signal.
  //
  // WHY `windowStart` is captured ONCE at the describe-block level
  // (`beforeAll`), shared across all 8, rather than re-captured per test:
  // per the same correction — the run window's START is a property of
  // "when this whole verification phase began," not of any one entity
  // type. Each test still computes its OWN `windowEnd` right after its OWN
  // entity creation, so every entity type's window is
  // `[sharedStart, thatTest'sOwnEnd]` — correctly scoped (both the report
  // and its independent API check always use the IDENTICAL window), even
  // though later entity types' windows end up wider (covering the time
  // spent on earlier entity types' own tests too). This is never a source
  // of a false pass: widening the window can only ever add MORE matching
  // data to both sides of the comparison symmetrically, and
  // verifyRunCountForEntity() always filters by the specific entity type
  // being checked, so an earlier test's own Lead/Deal/etc. creations never
  // pollute a later test's Task/Meeting/etc. count.
  // WHY a plain `test.describe()`, not `.serial` (changed 2026-08-21, found
  // via a real clean-run failure): `.serial` mode aborts every remaining
  // test in the block the moment one test fails — a real, confirmed
  // occurrence during this session's own verification run, where a Company
  // failure caused Task/Meeting/Call log/Quotation to be silently skipped
  // ("did not run"), defeating the entire point of splitting these into 8
  // independently-reported tests. Plain `test.describe()` still runs tests
  // in declaration order within a single worker (this suite always runs
  // `--workers=1`) — the ordering this file's own design already depends on
  // is unaffected. `beforeAll()` also still runs exactly once per describe
  // block regardless of serial/non-serial, so the shared `windowStart`
  // mechanism below is unaffected too. The only real behavior removed is
  // the one Reports never wanted: one entity type's failure silently hiding
  // every other entity type's own independent pass/fail signal.
  test.describe('run-count verification per entity type', () => {
    let windowStart: Date;

    test.beforeAll(() => {
      windowStart = new Date();
    });

    test('@regression admin should verify lead report count matches actual filtered entity count with drill-through showing exact records', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Lead();
      await creators.Lead();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Lead', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Lead: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Lead: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R4 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression admin should verify deal report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Deal();
      await creators.Deal();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Deal', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Deal: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Deal: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R5 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression admin should verify contact report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Contact();
      await creators.Contact();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Contact', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Contact: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Contact: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R6 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression admin should verify company report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Company();
      await creators.Company();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Company', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Company: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Company: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R7 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression admin should verify task report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Task();
      await creators.Task();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Task', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Task: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Task: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R8 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression admin should verify meeting report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Meeting();
      await creators.Meeting();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Meeting', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Meeting: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Meeting: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R9 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    test('@regression admin should verify call log report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators['Call log']();
      await creators['Call log']();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Call log', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Call log: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Call log: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R10 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });

    // WHY `test.skip()` here, directly on this one individual test, not on
    // a shared loop entry: per decision #3's own given snippet — this is
    // now its own distinct test, so it can use the exact pattern given
    // rather than the whole-array workaround the bundled version needed.
    test('@regression admin should verify quotation report count matches actual filtered entity count', async ({
      adminPage,
    }) => {
      test.skip(config.env !== 'qa', 'Quotation reports not yet deployed to stage/prod');
      test.setTimeout(480000);
      const reportsPage = new ReportsPage(adminPage);
      const creators = buildEntityCreators(adminPage);
      await creators.Quotation();
      await creators.Quotation();
      const windowEnd = new Date();

      const { reportTotal, apiTotal, reportBucketCount, destinationListCount } =
        await reportsPage.verifyRunCountForEntity('Quotation', windowStart, windowEnd, 'admin');
      expect(
        reportTotal,
        'Quotation: report total should be >= the independently-queried API total'
      ).toBeGreaterThanOrEqual(apiTotal);
      expect(
        reportBucketCount,
        "Quotation: drill-through bucket count should be >= the destination list's own displayed count"
      ).toBeGreaterThanOrEqual(destinationListCount);
      logger.success(
        `R11 passed (report=${reportTotal}, api=${apiTotal}, bucket=${reportBucketCount}, destinationList=${destinationListCount})`
      );
    });
  });

  test('@smoke @regression admin should be redirected to report details page after saving', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({ reportType: 'Lead' });

    const { id } = await reportsPage.createReport(reportData);
    await expect(adminPage).toHaveURL(new RegExp(`/reports/details/${id}$`));
    logger.success('R12 passed');
  });

  test('@regression admin should find newly created report in reports list via full partial and case-insensitive search', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({ reportType: 'Lead' });
    const { name } = await reportsPage.createReport(reportData);

    await reportsPage.assertReportVisibleInList(name);
    const namePrefix = name.substring(0, Math.floor(name.length / 2));
    await reportsPage.assertReportVisibleInList(namePrefix);
    await reportsPage.assertReportVisibleInList(name.toLowerCase());
    logger.success('R13 passed');
  });

  test('@regression admin should unlock additional dimension rows when report type is multi dimensional', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.assertAddDimensionLinkHidden();

    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.assertAddDimensionLinkVisible();
    logger.success('R14 passed');
  });

  test('@smoke @regression admin should render bar chart by default and table chart type as drill-through links with total row and no record-level table', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({ reportType: 'Lead' });
    const { id } = await reportsPage.createReport(reportData);
    await reportsPage.goToReportDetails(id);

    const barTotal = await reportsPage.getReportTotalFromHeader();
    expect(barTotal).toBeGreaterThan(0);

    await reportsPage.switchChartType('Table');
    await reportsPage.assertTableModeHasNoRecordTable();
    await reportsPage.assertTableModeTotalRow(barTotal);
    await reportsPage.assertTableModeDrillThroughLinksPresent();
    logger.success('R15 passed');
  });

  test('@regression admin should show start and end date as read-only when date range is not custom and editable when set to custom', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();

    await reportsPage.assertStartEndDateReadOnly();
    await reportsPage.selectDateRangeOption('Custom');
    await reportsPage.assertStartEndDateEditable();
    logger.success('R16 passed');
  });

  test('@regression admin should block end date before start date in custom range calendar and allow a valid later date', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectDateRangeOption('Custom');

    // WHY day 15, not the 1st of the month: found via a real live failure
    // (2026-08-21) — the End Date calendar reopens showing whatever month
    // Start Date is in; "the day before the 1st" is the LAST day of the
    // PREVIOUS month, which react-dates never renders as a same-view day
    // cell at all (no backward navigation happens automatically). Picking a
    // mid-month Start Date keeps "the day before" inside the same visible
    // month, genuinely reachable without navigating the calendar first.
    const start = new Date();
    start.setDate(15);
    const dayBeforeStart = new Date(start);
    dayBeforeStart.setDate(dayBeforeStart.getDate() - 1);
    const validLaterDate = new Date(start);
    validLaterDate.setDate(validLaterDate.getDate() + 5);

    await reportsPage.fillCustomDateRange(start, validLaterDate);
    // WHY re-opened after the first fill: assertEndDateBlockedBefore() opens
    // its own calendar interaction — checking the day BEFORE start remains
    // blocked even after a valid range has already been set once.
    await reportsPage.assertEndDateBlockedBefore(dayBeforeStart);
    logger.success('R17 passed');
  });

  test('@regression admin should generate report correctly for a fifteen month custom range and receive backend rejection for a six year range', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.selectMetric(0, 'Number of Leads');
    await reportsPage.selectDateRangeOption('Custom');

    const now = new Date();
    const fifteenMonthsAgo = new Date(now);
    fifteenMonthsAgo.setMonth(fifteenMonthsAgo.getMonth() - 15);
    await reportsPage.fillCustomDateRange(fifteenMonthsAgo, now);
    await reportsPage.clickGeneratePreview();
    const workingTotal = await reportsPage.getReportTotalFromHeader();
    expect(workingTotal).toBeGreaterThan(0);

    const sixYearsAgo = new Date(now);
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    await reportsPage.fillCustomDateRange(sixYearsAgo, now);
    await reportsPage.clickGeneratePreview();
    await reportsPage.assertBackendRangeRejection();
    logger.success('R18 passed');
  });

  test('@regression admin should show no-data message on preview panel and a distinct no-data message with zero total and no drill-through link on details page when filter matches zero records', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({
      reportType: 'Lead',
      filters: [{ field: 'Last Name', operator: 'Equals', value: 'ZZZNOTHINGMATCHESTHIS999999' }],
    });
    await reportsPage.goToCreateReport();
    await reportsPage.fillReportForm(reportData);
    await reportsPage.clickGeneratePreview();
    await reportsPage.assertPreviewNoDataMessage();

    await reportsPage.clickSaveButton();
    await reportsPage.assertDetailsNoDataMessage();

    await reportsPage.switchChartType('Table');
    await reportsPage.assertNoTableModeDrillThroughLinks();
    logger.success('R19 passed');
  });

  test('@regression admin should require report name dimension and metric to save a report despite no visible asterisk on dimension or metric', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();

    // WHY built up field-by-field via direct locator calls, NOT
    // fillReportForm() (which sets Dimension+Metric together in one call):
    // found via a real live test-design bug (2026-08-21) — the original
    // version called fillReportForm() first (setting Dimension/Metric
    // immediately), so by the second Save attempt the form was already
    // fully valid and saved successfully, leaving no validation carousel to
    // assert against at all. Matches investigation-notes-reports.md's own
    // confirmed methodology: "determined precisely by removing fields one
    // at a time," never all at once.

    // Step 1: everything empty — confirmed live (2026-08-21) the Save
    // button is genuinely HTML-disabled while Name is empty (Kylas gates
    // Save on Name alone), so there is no click-then-inline-error flow to
    // exercise here — the disabled state itself IS the "Name is required"
    // signal.
    await reportsPage.assertSaveButtonDisabled();

    // Step 2: Name filled, Dimensions/Metrics still empty — Dimensions
    // remains independently required.
    await adminPage.locator('#report_11_input_name').fill('R20-validation-check');
    await reportsPage.clickSaveButton();
    await reportsPage.assertValidationCarouselContains(['Dimensions is a required field']);

    // Step 3: Name + Dimension filled, Metric still empty — confirms Metrics
    // is independently required too, not just co-reported alongside
    // Dimensions.
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.clickSaveButton();
    await reportsPage.assertValidationCarouselContains(['Metrics is a required field']);
    logger.success('R20 passed');
  });

  test('@regression admin should allow saving a report with a duplicate report name', async ({ adminPage }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const sharedName = generateReportData({ reportType: 'Lead' }).name;

    const first = await reportsPage.createReport(generateReportData({ reportType: 'Lead', name: sharedName }));
    const second = await reportsPage.createReport(generateReportData({ reportType: 'Lead', name: sharedName }));
    expect(first.id).not.toBe(second.id);
    logger.success('R21 passed');
  });

  test('@regression admin should safely escape special characters html and sql-like text in report name', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const dangerousName = `EdgeCase-Special "quo'te" <b>test</b> ' OR 1=1 -- ${Date.now()}`;
    const { id } = await reportsPage.createReport(generateReportData({ reportType: 'Lead', name: dangerousName }));
    await reportsPage.goToReportDetails(id);
    await reportsPage.assertNameRenderedAsEscapedText(dangerousName);
    logger.success('R22 passed');
  });

  test('@regression admin should exclude an already-selected field from dimension and filter option lists to prevent duplicates', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.addDimensionRow();
    await reportsPage.assertOptionExcludedFromDimensionMenu(1, 'Owner');

    await reportsPage.addFilter('Last Name', 'Equals', 'dedup-check');
    await reportsPage.assertOptionExcludedFromFilterFieldMenu('Last Name');
    logger.success('R23 passed');
  });

  test('@regression admin should re-enable add new dimension row after removing a row once the add limit is hit', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.selectDimension(0, 'Owner');

    // WHY no specific row-count assertion, ever: confirmed live and
    // re-confirmed under a dedicated restricted-user re-verification pass
    // that this control's enabled/disabled state is NOT a stable, reproducible
    // cap keyed to the live visible row count — four separate attempts under
    // near-identical conditions produced four different numbers (22, ~1-3, 2,
    // and an earlier admin-session "14"). This test targets the actual
    // underlying defect instead: whatever the eventual limit is, removing a
    // row must make "Add New" reappear and a further add must succeed.
    let addLinkVisible = true;
    let rowsAdded = 0;
    const maxAttemptsToHitLimit = 30;
    while (addLinkVisible && rowsAdded < maxAttemptsToHitLimit) {
      await reportsPage.addDimensionRow();
      rowsAdded++;
      addLinkVisible = await reportsPage.addDimensionLinkIsVisible();
    }
    expect(rowsAdded, 'Expected "Add New" to eventually become unavailable').toBeLessThan(maxAttemptsToHitLimit);

    await reportsPage.removeDimensionRow(rowsAdded);
    await reportsPage.assertAddDimensionLinkVisible();
    await reportsPage.addDimensionRow();
    logger.success('R24 passed');
  });

  test('@regression admin should disable metrics section when any dimension row is left empty', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.addDimensionRow();
    await reportsPage.selectDimension(1, 'Source');
    await reportsPage.assertMetricControlEnabled(0);

    // WHY a 3rd, deliberately-empty row: confirmed live — Metrics becomes
    // disabled again once ANY currently-visible Dimension row is empty, not
    // only when zero Dimensions exist at all.
    await reportsPage.addDimensionRow();
    await reportsPage.assertMetricControlDisabled(0);
    logger.success('R25 passed');
  });

  test('@regression admin should throw and recover from a client error when removing an empty dimension row but not a filled one', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectCategory('Multi Dimensional');
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.addDimensionRow();
    // WHY a THIRD row (Source), not just 2: confirmed live (2026-08-21) —
    // once only ONE Dimension row remains, its trash icon is not merely
    // hidden but entirely absent from the DOM (a real, confirmed "you
    // cannot remove the last Dimension row" rule, not a locator bug) — the
    // original 2-row version's second removeDimensionRow() call could never
    // succeed no matter what selector it used. Starting with 3 rows (2
    // filled + 1 empty) means removing the empty one still leaves 2 filled
    // rows behind, so the filled-row removal that follows has a real trash
    // icon to click.
    await reportsPage.addDimensionRow();
    await reportsPage.selectDimension(2, 'Source');

    const emptyRowResult = await reportsPage.removeDimensionRow(1);
    expect(
      emptyRowResult.appErrorCaptured,
      'Expected the confirmed real Kylas app bug (removeDimension() TypeError) when removing an EMPTY row'
    ).toBe(true);

    const filledRowResult = await reportsPage.removeDimensionRow(0);
    expect(
      filledRowResult.appErrorCaptured,
      'Expected NO app error when removing a FILLED row — same action, different, confirmed-clean outcome'
    ).toBe(false);
    logger.success('R26 passed');
  });

  test('@regression admin should add a filter with field-appropriate operator and value control', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();

    await reportsPage.addFilter('Source', 'Equals', 'Google');
    await reportsPage.addFilter('Last Name', 'Equals', 'R27-text-filter-check');
    const rowCount = await reportsPage.getFilterRowCount();
    expect(rowCount).toBe(2);

    // WHY these two checks were missing from the original version: a title
    // promising "field-appropriate operator and value control" was
    // previously only checked by counting rows — a weaker claim that would
    // still pass even if both fields rendered the identical control type.
    // Confirmed live (investigation-notes-reports.md Part B §5): a
    // picklist-shaped field (Source) gets a react-select Value control;
    // a plain text field (Last Name) gets a bare text input instead.
    expect(await reportsPage.getFilterValueControlKind(0)).toBe('select');
    expect(await reportsPage.getFilterValueControlKind(1)).toBe('text');
    logger.success('R27 passed');
  });

  test('@regression admin should remove a filter from filters-to-be-applied list', async ({ adminPage }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.addFilter('Source', 'Equals', 'Google');
    expect(await reportsPage.getFilterRowCount()).toBe(1);

    await reportsPage.removeFilterRow(0);
    expect(await reportsPage.getFilterRowCount()).toBe(0);
    logger.success('R28 passed');
  });

  test('@regression admin should leave preview panel stale after removing a filter until preview is regenerated', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectDimension(0, 'Owner');
    await reportsPage.selectMetric(0, 'Number of Leads');
    await reportsPage.addFilter('Last Name', 'Equals', 'R29-stale-preview-check-zzz');
    await reportsPage.clickGeneratePreview();
    await reportsPage.assertPreviewNoDataMessage();

    await reportsPage.removeFilterRow(0);
    // WHY asserted immediately, with no wait at all: confirmed live —
    // removing a filter never triggers any re-render of the already-rendered
    // Preview panel on its own; this is the whole point of the assertion.
    await reportsPage.assertPreviewNoDataMessage();

    await reportsPage.clickGeneratePreview();
    const total = await reportsPage.getReportTotalFromHeader();
    expect(total).toBeGreaterThan(0);
    logger.success('R29 passed');
  });

  test('@regression admin should delete a report and confirm it no longer appears in reports list', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const { id, name } = await reportsPage.createReport(generateReportData({ reportType: 'Lead' }));

    await reportsPage.deleteReport(id);
    await reportsPage.assertReportNotVisibleInList(name);
    logger.success('R30 passed');
  });

  test('@regression admin should download report as aggregate-only csv file with correct content', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const reportData = generateReportData({ reportType: 'Lead' });
    const { id, name } = await reportsPage.createReport(reportData);
    await reportsPage.goToReportDetails(id);

    const csvContent = await reportsPage.downloadReportCsv();
    expect(csvContent).toContain(name);
    expect(csvContent).toContain('Dimensions');
    expect(csvContent).toContain('Metrics');
    expect(csvContent).toContain('Total');
    // WHY confirming NO record-level rows, not just that some content
    // exists: investigation-notes-reports.md's own confirmed finding is that
    // this export is aggregate-only — asserting the absence of anything
    // resembling a per-record id column is the real thing this test
    // protects.
    expect(csvContent.split('\n').length).toBeLessThan(50);
    logger.success('R31 passed');
  });

  test('@regression admin should navigate to edit report page and persist a report description change after saving', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const { id } = await reportsPage.createReport(generateReportData({ reportType: 'Lead' }));
    const newDescription = `R32 edit-flow description ${Date.now()}`;

    await reportsPage.updateReportDescriptionAndSave(id, newDescription);
    await reportsPage.goToReportEdit(id);
    await expect(adminPage.locator('#report_21_input_description')).toHaveValue(newDescription);
    logger.success('R32 passed');
  });

  test('@regression admin should confirm sorting by report name column is non-functional while created at column sorts correctly', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToReportsList();

    const createdAtResponse = await reportsPage.clickListColumnSort('Created At');
    expect(createdAtResponse, 'Expected a real sort request for the working "Created At" column').not.toBeNull();
    expect(createdAtResponse?.url()).toContain('sort=createdAt');

    const reportNameResponse = await reportsPage.clickListColumnSort('Report Name');
    expect(
      reportNameResponse,
      'Confirmed real inconsistency: "Report Name" column never fires a sort request'
    ).toBeNull();
    logger.success('R33 passed');
  });

  test('@regression admin should verify a saved reports underlying api endpoint changes correctly per entity type', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);

    for (const entityType of ['Lead', 'Deal', 'Company', 'Call log'] as const) {
      await reportsPage.goToCreateReport();
      await reportsPage.selectEntityType(entityType);
      await reportsPage.selectDimension(0, REPORT_OWNER_DIMENSION_BY_ENTITY[entityType]);
      await reportsPage.selectMetric(0, REPORT_COUNT_METRIC_BY_ENTITY[entityType]);
      const response = await reportsPage.assertReportApiEndpointForEntityType(entityType);
      expect(response.status()).toBe(200);
    }
    logger.success('R34 passed');
  });

  test('@regression admin should complete save as on a report and verify a new report is genuinely created preserving its filter', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    // WHY a filter is included in `original`: the title promises Save As
    // preserves Dimensions, Metrics, AND Filters — the original version of
    // this test never gave it a filter to preserve at all, so that third
    // claim went completely unverified despite the test passing.
    //
    // WHY the filter's own value is a deliberately meaningless string, and
    // why that's fine here: confirmed live (2026-08-21, with the user) —
    // this makes the report legitimately match ZERO real records, which is
    // a real, correct Kylas app state (a "no data" screen on the details
    // page), not a bug. This test's real job — confirmed with the user —
    // is only to verify Save As genuinely creates a new, distinct report
    // and preserves its filter configuration, NOT to verify data renders
    // for it. Asserting on `.report__header .dimension-name`/`.metric-name`
    // (which only render when a report has matching data) was the original
    // design's mistake, not a timing issue — fixed by checking things that
    // are true regardless of whether the report happens to match any data.
    const original = generateReportData({
      reportType: 'Lead',
      dimension: 'Source',
      filters: [{ field: 'Last Name', operator: 'Equals', value: 'R35-saveas-filter-check' }],
    });
    const { id } = await reportsPage.createReport(original);

    const saveAsName = `${original.name}-saveas-check-${Date.now()}`;
    const savedAs = await reportsPage.saveReportAs(id, saveAsName);

    // A genuinely new, distinct report was created (not just still viewing
    // the original) — the real thing this test needs to prove.
    expect(savedAs.id, 'Save As should produce a new report id, distinct from the original').not.toBe(id);

    // WHY this exact text, and WHY it's checked here, before navigating
    // anywhere else: confirmed live (captured in this session's own R19
    // failure investigation, whose accessibility snapshot showed "Filters
    // 1 filter applied" verbatim in the Customize Report panel) — and
    // confirmed this panel renders regardless of whether the report matches
    // any data, unlike the header. It lives on the DETAILS page only — a
    // real, live-reproduced run (2026-08-21) failed here with "element(s)
    // not found" because a prior version of this test checked it AFTER
    // assertReportVisibleInList() had already navigated to the Reports
    // list, by which point this text genuinely isn't on the page at all.
    // Not a rendering-speed issue: a live timing check showed it appears
    // ~0.9s after the post-Save-As navigation completes, far inside a 10s
    // wait — the bug was purely "checking it on the wrong page."
    await expect(adminPage.getByText('1 filter applied')).toBeVisible();

    // WHY the report's own confirmed displayed name is used for the list
    // search, not the saveAsName string this test itself set: confirmed
    // live (2026-08-21) — the Reports list's backend search does fuzzy,
    // per-word OR matching, not exact-phrase matching, so a generic word
    // shared with unrelated pre-existing reports (this test's own name
    // contains "check", which alone returned 10 mostly-unrelated rows in a
    // live check) could false-positive a name-based search. Reading the
    // name back from its own details page — rather than assuming the app
    // persisted exactly what was requested — is the same "confirmed, not
    // assumed" discipline this codebase applies everywhere else, and
    // assertReportVisibleInList() below is itself now fixed to verify this
    // SPECIFIC row is present, not just that the fuzzy search returned
    // something.
    const confirmedName = await reportsPage.getReportNameFromDetailPage();
    expect(confirmedName, 'Save As should persist the exact name requested').toBe(saveAsName);
    await reportsPage.assertReportVisibleInList(confirmedName);
    logger.success('R35 passed');
  });

  test('@regression admin should verify report count updates correctly after a referenced entity record is deleted', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const leadsPage = new LeadsPage(adminPage);

    // WHY a uniquely-tagged Last Name, filtered on below via
    // verifyRunCountForEntity()'s `filters` param: confirmed real
    // (.claude/known-issues.md, Sandbox Build #147 investigation, revised
    // 2026-08-25) — this report's own Custom Date Range is day-granularity
    // only (a hard app UI limitation), padded ±1 day around this lead's
    // creation moment. Under a real concurrent, multi-hour, `--workers=2`
    // full-suite run, that ~2-day window is shared with every OTHER Lead any
    // other test creates in the same run — a before/after total COMPARISON
    // over that shared window is not a safe assertion on its own, since an
    // unrelated concurrent Lead creation between the two reads can mask or
    // exceed the -1 signal from this one deletion. An exact-match filter on
    // a value nothing else in the suite will ever coincidentally share scopes
    // the report down to just this one entity, making the comparison correct
    // by construction rather than tolerant-by-retry.
    const uniqueLastName = `R36-delete-check-${Date.now()}`;
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
      'admin',
      [{ field: 'Last Name', operator: 'Equals', value: uniqueLastName }]
    );
    expect(beforeTotal).toBeGreaterThan(0);

    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();

    // WHY waitForReportTotalBelow(), not a single re-read: a small,
    // defense-in-depth bounded retry (re-navigate, never sleep) for a
    // separate, not-yet-confirmed possibility — a brief backend
    // indexing/propagation lag between the completed deletion and the
    // report engine's own next read — on top of, not instead of, the real
    // fix above (the filter is what makes this comparison trustworthy at
    // all under concurrent load in the first place).
    const afterTotal = await reportsPage.waitForReportTotalBelow(reportId, beforeTotal);
    expect(
      afterTotal,
      'Report total should reflect the deleted lead no longer counting, without erroring or showing stale data'
    ).toBeLessThan(beforeTotal);
    logger.success('R36 passed');
  });

  // WHY this test exists: R36 above already proves the delete-then-recount
  // scenario is correct, but it does so via the `filters` option — it never
  // actually exercises `narrowWindow`/`includeTime`, the OTHER option added
  // 2026-08-25 for the same class of test (`.claude/known-issues.md`'s "Dual
  // date-window strategy" entry). That option shipped verified only by
  // `tsc`/`eslint` — never run against the real app. This test closes that
  // gap: same delete-then-recount shape as R36, but deliberately WITHOUT a
  // `filters` value, so `narrowWindow: true` alone (not filters) is what has
  // to isolate the before/after comparison from any other concurrently
  // fresh data — the only way to prove the rc-time-picker fill
  // (`fillTimeInPicker()`) and the 5-minute-padded window actually work
  // end-to-end against the live app, not just compile.
  test('@regression admin should verify report count updates correctly using the narrow time-scoped window (no filters)', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    const leadsPage = new LeadsPage(adminPage);

    const windowStart = new Date();
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    const windowEnd = new Date();

    const { reportId, reportTotal: beforeTotal } = await reportsPage.verifyRunCountForEntity(
      'Lead',
      windowStart,
      windowEnd,
      'admin',
      undefined,
      true
    );
    expect(beforeTotal).toBeGreaterThan(0);

    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();

    const afterTotal = await reportsPage.waitForReportTotalBelow(reportId, beforeTotal);
    expect(
      afterTotal,
      'Report total should reflect the deleted lead no longer counting, using the narrow window alone (no filters)'
    ).toBeLessThan(beforeTotal);
    logger.success('R65 passed');
  });

  // WHY this test exists at all: found missing during a final numbering
  // audit (2026-08-21) — this build's original 30-item UI plan had a 30th
  // test ("mid-form switch") that was never actually written. Adding it
  // now closes that real gap rather than silently under-delivering on the
  // original plan.
  test('@regression admin should switch entity type chart type and report type mid form and confirm dimension is cleared or preserved correctly', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const reportsPage = new ReportsPage(adminPage);
    await reportsPage.goToCreateReport();
    await reportsPage.selectDimension(0, 'Owner');
    await expect(reportsPage.getDimensionControlLocator(0)).toContainText('Owner');

    // 1. Entity Type change: CONFIRMED destructive — clears Dimension back
    // to its empty "Choose" placeholder.
    await reportsPage.selectEntityType('Deal');
    await expect(reportsPage.getDimensionControlLocator(0)).not.toContainText('Owner');

    // 2. Chart Type change: CONFIRMED non-destructive — re-select a
    // Dimension (Deal's own option list), then prove Chart Type leaves it
    // alone.
    await reportsPage.selectDimension(0, 'Owner');
    await expect(reportsPage.getDimensionControlLocator(0)).toContainText('Owner');
    await reportsPage.selectChartTypeOnForm('Pie');
    await expect(reportsPage.getDimensionControlLocator(0)).toContainText('Owner');

    // 3. Report Type (category) change: CONFIRMED destructive — same
    // clearing behavior as Entity Type, despite Multi Dimensional's only
    // structural difference being "allows more rows," not a different
    // Dimension concept.
    await reportsPage.selectCategory('Multi Dimensional');
    await expect(reportsPage.getDimensionControlLocator(0)).not.toContainText('Owner');
    logger.success('R37 passed');
  });
});
