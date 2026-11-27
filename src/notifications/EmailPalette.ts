// The email's colour decisions that are not status colours, in ONE place (2026-11-25).
//
//  - Info colour per environment: tiles that only inform (Total, Duration, Modules, Rerun, Not rerun, Rerun duration, the error-count tile) and the ENV
//    badge take the colour of the environment the run belongs to, so a reader sees at a glance which environment an email is about: QA sky blue,
//    STAGING lavender, PROD a deeper blue. An environment that is not listed falls back to a neutral slate.
//  - Retry colour: "Flaky / Passed on retry" is yellow everywhere it appears (tile, donut slice, legend dot, segmented bar, pill).
//  - Status colours (green passed, red failed, slate grey skipped, grey for a zero) are NOT here and never depend on the environment: their meaning
//    must not change.
// QA, STAGING and the fallback are light backgrounds with dark text; PROD is a deeper blue with white text. The contrast (WCAG AA, 4.5:1) of every
// pair is asserted in scripts/check-build239.ts.

export interface Swatch {
  /** Background (a tile fill, a badge, a bar segment). */
  bg: string;
  /** Text on that background. */
  text: string;
}

export const ENV_INFO: Record<string, Swatch> = {
  qa: { bg: '#93C5FD', text: '#1E3A8A' }, // sky blue
  staging: { bg: '#C4B5FD', text: '#3B0764' }, // lavender
  prod: { bg: '#0C6FAC', text: '#ffffff' }, // deeper blue, white text (about 5.4:1)
};

/** An environment that is not in ENV_INFO. */
export const INFO_FALLBACK: Swatch = { bg: '#CBD5E1', text: '#1E293B' }; // neutral slate

export const RETRY: Swatch = { bg: '#FDE047', text: '#713F12' }; // yellow

export function infoSwatch(env: string | undefined): Swatch {
  return ENV_INFO[(env ?? '').trim().toLowerCase()] ?? INFO_FALLBACK;
}
