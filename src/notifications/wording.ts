// One place for count-based wording, so no sentence says "1 test(s)" or "1 are" (2026-11-25, build #239: "1 are rerun-shard attempts").
/** "1 test", "2 tests"; pass the plural when it is not just +s ("1 category", "2 categories"). */
export const plural = (n: number, noun: string, pluralNoun = `${noun}s`): string => `${n} ${n === 1 ? noun : pluralNoun}`;
/** The noun alone ("test" / "tests") for sentences that print the number themselves. */
export const nounFor = (n: number, noun: string, pluralNoun = `${noun}s`): string => (n === 1 ? noun : pluralNoun);
/** "was" / "were", "is" / "are", "has" / "have" by count. */
export const be = (n: number): string => (n === 1 ? 'is' : 'are');
export const wasWere = (n: number): string => (n === 1 ? 'was' : 'were');
export const hasHave = (n: number): string => (n === 1 ? 'has' : 'have');
