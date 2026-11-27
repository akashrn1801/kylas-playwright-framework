import { randomInt } from 'crypto';

// WHY (2026-10-30): the accounts' duplicate check rejects a lead/contact/company whose e-mail OR phone is
// already used (EMAIL_PHONE), and tests keep everything they create, so QA and staging hold more and more
// records. Faker values alone repeat across runs, and a millisecond timestamp repeats across two workers
// in the same millisecond. Every e-mail and phone a test sends comes from here.
//
// E-mail: <prefix>.<epoch ms>.<per-process counter>.<8 random hex digits>@testkylas.com — unique in a process
// (counter), over time (ms) and across processes/shards (random part).
// Phone: the formats the app accepts are 10 digits starting 6-9 (the number a "Mobile" field takes, India).
// That space is small (4 x 10^9), so a phone is random, never repeats inside a process (the set below), and
// the lead create path additionally asks the app whether it is already used (LeadsPage.createLead,
// LeadApi.createLead — `has-duplicates`) instead of trusting luck against the history already on the account.

let counter = 0;
const issuedPhones = new Set<string>();

export function uniqueEmail(prefix = 'test'): string {
  counter += 1;
  const local = prefix.toLowerCase().replace(/[^a-z0-9.]+/g, '') || 'test';
  const random = randomInt(0, 0xffffffff).toString(16).padStart(8, '0');
  return `${local}.${Date.now()}.${counter}.${random}@testkylas.com`;
}

export function uniquePhone(): string {
  for (;;) {
    const phone = String(randomInt(6, 10)) + String(randomInt(0, 1_000_000_000)).padStart(9, '0');
    if (!issuedPhones.has(phone)) {
      issuedPhones.add(phone);
      return phone;
    }
  }
}

// "jane.o'neil" -> "jane.oneil": the readable part of an e-mail built from a person's name
export function emailLocalPart(firstName: string, lastName: string): string {
  return `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]+/g, '');
}
