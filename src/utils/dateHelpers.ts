// WHY: extracted out of leadFactory.ts (2026-07-14) when Contact custom
// fields needed the identical "today through today+1 month" random-date
// logic — this helper has zero Lead-specific meaning (pure date arithmetic
// relative to the real current time), so duplicating it per-entity-factory
// would violate the "no duplicated logic" bar for no benefit. Entity-owned
// pieces (each module's own <MODULE>_CUSTOM_FIELD_NAMES / CustomFieldData
// interface / generateXCustomFieldData()) stay separate per factory per
// CLAUDE.md's Custom Fields pattern — only this genuinely generic piece
// moved out.
export function randomFutureDateWithinOneMonth(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offsetDays = Math.floor(Math.random() * 31); // 0..30 inclusive
  const result = new Date(today);
  result.setDate(result.getDate() + offsetDays);
  result.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);
  return result;
}
