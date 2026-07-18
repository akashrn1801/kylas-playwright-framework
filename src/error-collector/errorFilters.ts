// WHY: These are background polling/prefetch API calls that get aborted
// when Playwright navigates away from a page. They are NOT real failures —
// the browser cancels them on navigation. Only real API errors have status codes.
export const ABORT_ON_NAVIGATE_PATTERNS: RegExp[] = [
  /\/v1\/users\/me$/i,
  /\/v1\/users\/lookup/i,
  /\/v1\/users\/\d+$/i,
  /\/v1\/configurations\/uniqueness/i,
  /\/v1\/calendar-oauth\/accounts/i,
  /\/v1\/marketplace\/apps\/actions/i,
  /\/v1\/ai-agent\/workflows\/subscribed/i,
  /\/v1\/tasks\/search\?/i,
  /\/v1\/tasks\/search-lists/i,
  /\/v1\/ui\/layouts\/list\//i,
  /\/v1\/ui\/layouts\/EDIT\//i,
  /\/v1\/tasks\/search-lists\/preferred/i,
  /\/v1\/rules\/search\/action-logs/i,
  /\/v1\/ui\/apps\/settings/i,
  /\/v1\/dashboards\//i,
  // Module-specific API calls that abort on navigation
  /\/v1\/deals\/\d+$/i,
  /\/v1\/meetings\/\d+$/i,
  /\/v1\/tasks\/\d+$/i,
  /\/v1\/contacts\/\d+$/i,
  /\/v1\/companies\/\d+$/i,
  /\/v1\/leads\/search/i,
  /\/v1\/deals\/search/i,
  /\/v1\/meetings\/search/i,
  /\/v1\/tasks\/search/i,
  // Score rules service — intermittently down on QA (infra issue, not app bug)
  /\/v1\/score-rules\//i,
  // Tenant usage — aborts on navigation
  /\/v1\/tenants\/usage/i,
  // Meetings layout list — aborts on navigation
  /\/v1\/meetings\/layout\/list/i,
  // Contact search — aborts on navigation
  /\/v1\/search\/contact/i,
  // Entity label + user settings — aborts on navigation
  /\/v1\/entities\/label/i,
  /\/v1\/users\/me\/settings/i,
  /\/v1\/users\/me\/permissions/i,
  // Picklists standard — aborts on navigation (background prefetch)
  /\/v1\/picklists\/standard/i,
  // Quotation API calls that abort on navigation
  /\/v1\/quotations\/\d+$/i,
  /\/v1\/quotations\/search/i,
  /\/v1\/quotations\/layout/i,
  /\/v4\/reports\/deals/i,
  /\/v1\/layouts\/contact\/detail/i,
  // Entity detail lookups that abort on navigation
  /\/v1\/leads\/\d+$/i,
  /\/v1\/contacts\/\d+$/i,
  /\/v1\/companies\/\d+$/i,
  /\/v1\/deals\/\d+$/i,
  /\/v1\/tasks\/\d+\/relation/i,
  // Dashboard background polls
  /\/v1\/search\/smart-list\//i,
  /\/v3\/reports\//i,
  /\/v1\/reports\//i,
  // Image assets aborting on navigation
  /\.gif$/i,
  /\.png$/i,
  /\/images\//i,
  // Call logs layout list — aborts on navigation
  /\/v1\/call-logs\/layout\/list/i,
  // Call logs search — aborts on navigation when switching pages
  /\/v1\/call-logs\/search/i,
  // Call logs detail — aborts on navigation
  /\/v1\/call-logs\/\d+/i,
  // Dashboards background poll — aborts on navigation
  /\/v1\/dashboards$/i,
  // Smart assistant — background feature check
  /\/v1\/tenants\/smart-assistant/i,
  // Tenants background poll
  /\/v1\/tenants$/i,
  // Notes relation — aborts on navigation
  /\/v1\/notes\/relation/i,
  // Tasks complete — aborts on navigation
  /\/v1\/tasks\/\d+\/complete/i,
  // Call logs layout edit view
  /\/v1\/call-logs\/layout\?view=edit/i,
  // Search lists preferred
  /\/v1\/search-lists\/preferred/i,
  // Deals layouts list
  /\/v1\/deals\/layouts\/list/i,
  // WHY: confirmed live (2026-07-16) in two separate, otherwise-fully-passing
  // runs (Leads full suite 44/44, and an earlier Deals RBAC run) — same
  // "aborts on navigation" reasoning as the existing meetings/layout/list
  // entry above, just the singular edit-view variant, not previously listed.
  /\/v1\/meetings\/layout\?view=edit/i,
  // WHY: confirmed live (2026-07-16) in an otherwise-passing test
  // ("admin shares deal with Update Note Task Meeting permissions and
  // restricted user can do all four") — this is the query-param form
  // (?targetEntityType=...&targetEntityId=...), distinct from the
  // numeric-id `/v1/tasks/\d+/relation` pattern already covered above;
  // same reasoning applies (aborts on navigation, zero test impact).
  /\/v1\/tasks\/relation(\?|$)/i,
  // WHY: NOT independently reproduced in this session's own test runs —
  // added on the strength of the user-reported sandbox CI run (2026-07-16),
  // which showed both firing as net::ERR_ABORTED without correlating to any
  // test failure in that run. Same "layout widget aborts on navigation"
  // reasoning as the sibling entries above (deals/layouts/list,
  // meetings/layout?view=edit, call-logs/layout?view=edit) — flagged here as
  // second-hand evidence, not personally confirmed, in case this needs
  // revisiting if a real failure ever correlates with either endpoint.
  /\/v1\/deals\/layout(\?|$)/i,
  /\/v1\/products\/layout(\?|$)/i,
  // WHY: confirmed live 2026-07-17 — the overnight full-suite run (272 tests,
  // 6.5h) surfaced these as net::ERR_ABORTED on otherwise cleanly-passing
  // tests. Cross-checked each against the run's own final pass/fail summary
  // (1 failed, 5 flaky, 266 passed) before the raw per-error report was lost
  // to a later run overwriting reports/qa/misc-errors.json — none of these
  // specific endpoints appear among the 6 tests that had any failure/flake,
  // so each is confirmed zero test-outcome correlation for this run. Same
  // "navigate-away abort" reasoning as every other entry in this list —
  // these are additional endpoints not previously seen, not new mechanisms.
  /\/v1\/search\/deal\b/i, // distinct from the existing /v1/deals/search above — reversed path
  /\/v1\/search\/lead\b/i,
  /\/v1\/search\/company\b/i,
  /\/v1\/layouts\/lead\/edit/i,
  /\/v1\/layouts\/lead\/detail/i,
  /\/v1\/layouts\/task\/create/i,
  /\/v1\/leads\/layout\/list/i,
  /\/v1\/deals\/layout\/list/i, // singular "layout", distinct from the existing /v1/deals/layouts/list (plural) above
  /\/v2\/email-threads\/search/i,
  /\/v1\/oauth\/(gmail|outlook)\/authorization-url/i,
  // Bare entity-collection GETs (no id) — distinct from the existing
  // /v1\/contacts\/\d+$ / /v1\/leads\/\d+$ single-record patterns above.
  /\/v1\/contacts\/?$/i,
  /\/v1\/leads\/$/i,
  // WHY: confirmed live 2026-07-18 (full-suite run) — both are a background
  // list/lookup refetch aborted by navigating away before it resolves, same
  // "navigate-away abort" reasoning as every other entry in this list.
  // Company-detail's contact-list refetch (query-param form, distinct from
  // any single-record /v1/contacts/\d+$ pattern above) — confirmed on 2
  // "add a contact" flows in companies.spec.ts, zero test-outcome correlation.
  /\/v1\/contacts\?companyId=/i,
  // Meeting-invitee lookup fired with an empty query during clone — confirmed
  // on "admin should clone a meeting and verify cloned meeting exists", which
  // passed cleanly with no assertion depending on this endpoint.
  /\/v1\/meetings\/meeting-invitee\/lookup/i,
];

export const NOISE_PATTERNS: RegExp[] = [
  // WHY: HTTP 429 rate limiting — QA environment under load, not app bugs
  /HTTP 429/i,
  // WHY: "Failed to load resource" console errors are always duplicated by response-error
  // which captures full details (method, status, body). Filter the console duplicate.
  /Failed to load resource: the server responded with a status of/i,
  /Grammarly/i,
  /grammarly/i,
  /HW_frame/i,
  /headway-widget/i,
  /headway\.io/i,
  /content-script/i,
  /record-api/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /CKEditor/i,
  /widget-toolbar-no-items/i,
  /Warning: Each child in a list/i,
  /Warning: React does not recognize/i,
  /notifications\/unread/i,
  /favicon\.ico/i,
  /WebSocket connection to/i,
  /disconnected port/i,
  /Attempting to use a disconnected/i,
  // Firebase push notification (expected — test browser has no notification permission)
  /permission-blocked/i,
  /messaging\/permission-blocked/i,
  /registration token/i,
  // Sentry rate limiting (non-actionable in test env)
  /sentry\.io/i,
  // Third-party embeds timing out
  /viasocket\.com/i,
  /embedfrontend/i,
  // WHY: Kylas app bug — MeetingCreate JS crash on intermittent QA env state.
  // App recovers on retry — not actionable from test perspective.
  /Cannot read properties of undefined.*find/i,
];

export const NOISE_URL_PATTERNS: RegExp[] = [
  /headway-widget\.net/i,
  /grammarly\.com/i,
  /chrome-extension/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /sentry\.io/i,
  /viasocket\.com/i,
  /headwayapp\.co/i,
  /zohocdn\.com/i,
  /zoho\.com/i,
  /cloudflareinsights\.com/i,
  /cloudflare\.com/i,
  // Stripe payment scripts (third-party, not Kylas app)
  /js\.stripe\.com/i,
  /stripe\.com/i,
  // Font assets aborting on navigation (expected browser behaviour)
  /font-awesome/i,
  /\.woff2/i,
  /\.woff/i,
  /\.ttf/i,
  // WHY: Kylas app bug — company chip clear triggers "e is not iterable" in
  // componentDidUpdate. App still saves successfully. Raised as bug KYL-XXXX.
  /e is not iterable/i,
];

// WHY: These are expected RBAC 404s — restricted user cannot access admin-owned entities.
// The app correctly returns 404 when restricted user tries to fetch Lead/Contact/Company/Deal
// owned by admin. This is correct security behaviour, not a bug.
export const RBAC_EXPECTED_MESSAGES: RegExp[] = [
  // WHY: Tasks RBAC — restricted user cannot access admin-owned task entity
  /Resource doesnt seem to exists or you dont have enough permissions/i,
  /The record doesn.t seem to exist, or you don.t have enough permissions/i,
  /you don.t have enough permissions to access it/i,
  /not authorised to perform this operation/i,
];

export function isNoise(message: string, url?: string): boolean {
  // WHY: 422 with errorCode 029003 = expected Kylas RBAC enforcement, not a bug
  if (message.includes('422') && url?.includes('/quotations')) return true;
  const fullText = `${message} ${url || ''}`;
  if (NOISE_PATTERNS.some((p) => p.test(fullText))) return true;
  if (url && NOISE_URL_PATTERNS.some((p) => p.test(url))) return true;
  // WHY: ERR_ABORTED on known background polling URLs = navigation abort, not real error
  if (
    message?.includes('ERR_ABORTED') &&
    url &&
    ABORT_ON_NAVIGATE_PATTERNS.some((p) => p.test(url))
  )
    return true;
  return false;
}

// WHY: Separate check for RBAC expected errors — these should be tracked differently
// They are NOT noise (we want to know they happened) but they are EXPECTED behaviour
// Use isExpectedRbacError() to classify them separately in the error collector
// WHY: 422 with errorCode 029003 = expected RBAC behaviour, not a bug
export const RBAC_EXPECTED_STATUS_CODES: number[] = [422];
export const RBAC_EXPECTED_ERROR_CODES: string[] = ['029003'];

export function isExpectedRbacError(message: string, apiErrorMessage?: string): boolean {
  // WHY: HTTP 422 with errorCode 029003 = Kylas RBAC enforcement — expected behaviour
  if (
    message.includes('422') &&
    (message.includes('029003') ||
      apiErrorMessage?.includes('Invalid company') ||
      apiErrorMessage?.includes('Invalid contact'))
  )
    return true;
  const text = `${message} ${apiErrorMessage || ''}`;
  return RBAC_EXPECTED_MESSAGES.some((p) => p.test(text));
}

// WHY: Confirmed live (2026-07-07 reporting audit + overnight QA validation) —
// ABORT_ON_NAVIGATE_PATTERNS above already enumerates these exact URLs, but
// isNoise() only applies that list when the message is ERR_ABORTED (the request
// never completed). A HTTP 4xx/5xx response-error on the SAME url is a different,
// stronger signal — the request DID complete and the server DID reject it — so it
// must not be dropped by the same blanket rule. This is a deliberately NARROW
// subset of ABORT_ON_NAVIGATE_PATTERNS: only endpoints individually confirmed,
// live, on 2026-07-07, to be non-load-bearing side-panel/bootstrap/reporting
// widgets whose failure (400 or 500, observed both) never once correlated with a
// test failure across two full validation passes (~500 test executions). Every
// entity CRUD/detail/search/layout endpoint (e.g. /v1/deals/\d+$, */search,
// */layout*, /v1/users/me$, /v1/tasks/\d+/complete) is intentionally EXCLUDED —
// those ARE load-bearing (waitForXDetailsPage() etc. depend on them per
// CLAUDE.md's canonical patterns), so a real 4xx/5xx there must keep surfacing as
// unexpected. Do not add an endpoint here without the same live-evidence bar —
// widening this list is exactly the "band-aid that could bury a real outage"
// risk this mechanism exists to avoid.
export const BACKGROUND_WIDGET_NOISE_PATTERNS: RegExp[] = [
  // AI workflow subscription check — confirmed both 400 and 500, 3+ sightings
  // across deals/call-logs/tasks modules, zero test impact each time.
  /\/v1\/ai-agent\/workflows\/subscribed/i,
  // Calendar integration status widget — confirmed 400, zero test impact.
  /\/v1\/calendar-oauth\/accounts/i,
  // Marketplace apps side-panel widget — confirmed 400, zero test impact.
  /\/v1\/marketplace\/apps\/actions/i,
  // Activity-feed widget on entity detail pages — confirmed 400, zero test impact.
  /\/v1\/rules\/search\/action-logs/i,
  // Background as-you-type duplicate-value checks — tests assert on the form's
  // own validation UI, never on this API's response directly.
  /\/v1\/configurations\/uniqueness/i,
  // Tenant-level feature/usage checks — confirmed 400 on /tenants and
  // /tenants/usage, zero test impact; /smart-assistant is the same family.
  /\/v1\/tenants\/usage/i,
  /\/v1\/tenants\/smart-assistant/i,
  /\/v1\/tenants$/i,
  // Generic entity-label lookup widget — confirmed 400, zero test impact.
  /\/v1\/entities\/label/i,
  // User preference/permission side-reads — deliberately narrower than the bare
  // /v1/users/me$ identity endpoint, which stays excluded (see WHY above).
  /\/v1\/users\/me\/settings/i,
  /\/v1\/users\/me\/permissions/i,
  // App-level UI settings widget — confirmed 400, zero test impact.
  /\/v1\/ui\/apps\/settings/i,
  // Dashboard background polls — no test in this suite navigates to or asserts
  // on the dashboard (verified: zero matches for "dashboards" across tests/).
  /\/v1\/dashboards\/?$/i,
  // Dashboard summary-card widgets on entity list pages — confirmed 400 on
  // /v3/reports/leads/summary and /v3/reports/deals/summary, zero test impact.
  /\/v3\/reports\//i,
  /\/v1\/reports\//i,
  /\/v4\/reports\/deals/i,
  // Score-rules service — already documented above as "intermittently down on
  // QA (infra issue, not app bug)" for the abort case; extending consistently.
  /\/v1\/score-rules\//i,
  // Standard picklists background prefetch.
  /\/v1\/picklists\/standard/i,
  // WHY: confirmed live 2026-07-17 (overnight full-suite run, cross-checked
  // against the run's own final pass/fail summary before the raw report was
  // lost to a later run overwriting it) — a background "has-duplicates"
  // check fires on Lead/Company detail-page loads and 400s with "doesn't
  // seem to exist or you don't have enough permissions" whenever the record
  // is either correctly inaccessible to the viewer (an RBAC-denial scenario)
  // or has just been deleted (checking duplicates on a gone record). 4
  // confirmed instances (2 leads, 2 companies), all 4 on tests that passed
  // cleanly with no assertion depending on this endpoint. Narrower evidence
  // base than the ~500-execution bar documented above for the original
  // entries in this list, but each instance has a fully-explained, confirmed
  // mechanism — not a guess.
  /has-duplicates/i,
  // WHY: confirmed live 2026-07-18 — the dashboard header's report/announcement
  // icon images, confirmed failing (see BACKGROUND_WIDGET_CONNECTION_ERROR_PATTERN
  // below) alongside the already-covered marketplace/ai-agent widgets above, on
  // the same single otherwise-cleanly-passing test. Same "non-load-bearing
  // header icon" reasoning — no test in this suite asserts on these images.
  /\/images\/reports\.svg/i,
  /\/images\/announcements\.svg/i,
];

// WHY: confirmed live 2026-07-18 (full-suite run) — the same non-load-bearing
// background widgets in BACKGROUND_WIDGET_NOISE_PATTERNS can fail with a
// connection-level error (never reaching the server) instead of a completed
// 4xx/5xx — same "widget failed, nothing asserts on it" story, just a
// different failure mode. Deliberately narrow: only genuinely transient,
// connection-layer signatures (mirrors BasePage.ts's own narrow allowlist for
// the same class of error) — never HTTP 4xx/5xx (those go through the
// completed-response check below) and never ERR_ABORTED (that's a routine
// nav-cancel, already handled by isNoise()/ABORT_ON_NAVIGATE_PATTERNS).
const BACKGROUND_WIDGET_CONNECTION_ERROR_PATTERN =
  /ERR_ADDRESS_UNREACHABLE|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_(RESET|REFUSED|TIMED_OUT)|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i;

// WHY: confirmed live 2026-07-18 — Lead/Contact's custom "Paragraph Text"
// field has no client-side length check (see CLAUDE.md's Custom Fields
// section) and is only rejected server-side on Save with this generic
// "Uhoh! Your data is invalid" message. The dedicated negative tests
// ("should see validation errors for invalid custom field values and not
// save the lead/contact") deliberately trigger this — it's the test passing,
// not a bug. Matched narrowly on the specific field name in the raw response
// body so a genuine, different validation failure on the same endpoint still
// surfaces as unexpected.
const DELIBERATE_VALIDATION_ERROR_SIGNATURE = /"field":"cfParagraphText"/i;

export function isExpectedBackgroundNoise(
  message: string,
  url?: string,
  responseBody?: string
): boolean {
  if (responseBody && DELIBERATE_VALIDATION_ERROR_SIGNATURE.test(responseBody)) return true;
  if (!url) return false;
  const isCompletedHttpError = /HTTP [45]\d\d/.test(message);
  const isConnectionFailure = BACKGROUND_WIDGET_CONNECTION_ERROR_PATTERN.test(message);
  // WHY: Only applies to completed HTTP error responses or the narrow connection-
  // failure list above, not ERR_ABORTED (that case is already fully handled by
  // isNoise() against the broader ABORT_ON_NAVIGATE_PATTERNS list).
  if (!isCompletedHttpError && !isConnectionFailure) return false;
  return BACKGROUND_WIDGET_NOISE_PATTERNS.some((p) => p.test(url));
}
