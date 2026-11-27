import { Page } from '@playwright/test';

// WHY this exists (CO12, ADR 0016): the app throws an uncaught render error on some company pages
// ("TypeError: Cannot read properties of undefined (reading 'find')" in QuotationApprovalStateFieldValue,
// plan §8/§13) and the page is left without the card. The test then waited the full 15 s for an element
// that can never appear and reported "element(s) not found", hiding the real cause. This remembers the
// page's uncaught errors so a wait can stop at once and name the error. It never retries, reloads or hides.

interface PageErrorState {
  first: Error | null;
  listeners: Set<(error: Error) => void>;
}

const states = new WeakMap<Page, PageErrorState>();

export function trackPageErrors(page: Page): void {
  if (states.has(page)) return;
  const state: PageErrorState = { first: null, listeners: new Set() };
  states.set(page, state);
  // A new document starts clean: an error from the previous page must not fail waits on the next one.
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) state.first = null;
  });
  page.on('pageerror', (error) => {
    state.first ??= error;
    for (const listener of state.listeners) listener(error);
  });
}

/** Resolves with the uncaught page error as soon as one happens; `stop()` removes the listener. */
export function pageErrorSignal(page: Page): { promise: Promise<Error>; stop: () => void } {
  const state = states.get(page);
  if (!state) return { promise: new Promise<Error>(() => undefined), stop: () => undefined };
  if (state.first) return { promise: Promise.resolve(state.first), stop: () => undefined };
  let listener: (error: Error) => void = () => undefined;
  const promise = new Promise<Error>((resolve) => {
    listener = resolve;
    state.listeners.add(listener);
  });
  return { promise, stop: () => state.listeners.delete(listener) };
}
