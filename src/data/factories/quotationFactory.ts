import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

// ──────────────────────────────────────────────────────────────────────────
// Quotation Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-29/30 child-entity investigation) — Quotation
// has the same 8 custom fields as Meeting/Deal (Text, Paragraph, Number,
// PickList, Checkbox, Date, DateTimePicker, UrlField — no MultiPickList,
// same as every child entity). Live on QA today; Stage does not have them
// yet (as of this writing). QUOTATION_CUSTOM_FIELD_NAMES is its own single
// source of truth, per CLAUDE.md's Custom Fields pattern — never import
// another module's constant here even where values happen to coincide.
//
// WHY 'URLField' (capital URL), matching Meeting: confirmed live via DOM
// inspection of the real input id (`..._input_customFieldValues.cfURLField`)
// — the same naming drift vs. Lead/Deal/Contact/Company's `cfUrlField`, this
// time on Quotation too. Confirmed independently, not assumed to transfer
// from Meeting.
//
// WHY the LEGACY suffix convention (`_input_customFieldValues.cf<Name>`),
// unlike Meeting/Call Log's shorter `_input_cf<Name>`: confirmed live via the
// same DOM inspection — Quotation's custom-field ids use the full
// "customFieldValues." segment, identical to Lead/Deal/Contact/Company/Task.
// This means every BasePage custom-field helper call below uses the default
// suffixStyle ('legacy') — no explicit 'plain' argument needed anywhere in
// QuotationsPage, unlike MeetingsPage.
export const QUOTATION_CUSTOM_FIELD_NAMES = {
  textField: 'TextField',
  paragraphText: 'ParagraphText',
  number: 'Number',
  pickList: 'PickList',
  checkbox: 'Checkbox',
  date: 'Date',
  dateTimePicker: 'DateTimePicker',
  urlField: 'URLField',
} as const;

export type QuotationCustomFieldKey = keyof typeof QUOTATION_CUSTOM_FIELD_NAMES;

export interface QuotationCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList options only exist live in the DOM (never hardcode them) —
  // this starts as a placeholder and is overwritten in place by
  // QuotationsPage.fillQuotationCustomFields() with whatever was actually
  // selected at fill time, so the same `data` object stays accurate for
  // later verification against the detail page.
  pickList: string;
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateQuotationCustomFieldData(
  overrides: Partial<QuotationCustomFieldData> = {}
): QuotationCustomFieldData {
  return {
    textField: `CF-Text-${faker.string.alphanumeric(12)}`,
    paragraphText: faker.lorem.paragraph(),
    number: faker.number.int({ min: 1, max: 100000 }),
    pickList: '',
    checkbox: faker.datatype.boolean(),
    date: randomFutureDateWithinOneMonth(),
    dateTimePicker: randomFutureDateWithinOneMonth(),
    urlField: `https://example.com/${faker.string.alphanumeric(10)}`,
    ...overrides,
  };
}

export enum QuotationStatus {
  Draft = 'Draft',
  Negotiation = 'Negotiation',
  Delivered = 'Delivered',
  OnHold = 'On Hold',
  Confirmed = 'Confirmed',
}

export interface ProductRowData {
  discountPercent: number;
  taxPercent: number;
  adjustmentPercent: number;
  discount?: number; // ← ADD - alias used in specs
  tax?: number;
}

export interface QuotationData {
  quotationNumber: string;
  dealName?: string;
  summary: string;
  status: QuotationStatus;
  generationDate: Date;
  validTill: Date;
  additionalDiscount: number;
  additionalTax: number;
  adjustment: number;
  billingAddress: string;
  billingCity: string;
  billingState: string;
  billingZipcode: string;
  sameShippingAsBilling: boolean;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingZipcode?: string;
  customFields: QuotationCustomFieldData;
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(n: number): Date {
  const d = today();
  d.setDate(d.getDate() + n);
  return d;
}

function randomAddressFields() {
  return {
    billingAddress: faker.location.streetAddress(),
    billingCity: faker.location.city(),
    billingState: faker.location.state(),
    // WHY: billing/shipping country is no longer a factory value — QuotationsPage
    // selects it via selectRandomCountry() (random index, not text match), so
    // there's nothing for the factory to generate or pass through here.
    billingZipcode: faker.string.numeric({ length: 6 }),
  };
}

export function generateQuotationData(overrides: Partial<QuotationData> = {}): QuotationData {
  const ts = Date.now();
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return {
    quotationNumber: `QUO-${ts}`,
    summary: faker.lorem.words(4),
    status: QuotationStatus.Draft,
    generationDate: today(),
    validTill: daysFromNow(30),
    additionalDiscount: faker.number.int({ min: 0, max: 15 }),
    additionalTax: faker.number.int({ min: 0, max: 18 }),
    adjustment: faker.number.int({ min: -5, max: 5 }),
    ...randomAddressFields(),
    sameShippingAsBilling: true,
    customFields: generateQuotationCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

export function generateAdminQuotationData(overrides: Partial<QuotationData> = {}): QuotationData {
  const ts = Date.now();
  return generateQuotationData({
    quotationNumber: `ADM${ts}`,
    summary: `ADM${ts} ${faker.lorem.words(3)}`,
    ...overrides,
  });
}

export function generateRestrictedQuotationData(
  overrides: Partial<QuotationData> = {}
): QuotationData {
  const ts = Date.now();
  return generateQuotationData({
    quotationNumber: `RES${ts}`,
    summary: `RES${ts} ${faker.lorem.words(3)}`,
    ...overrides,
  });
}

export function generateProductRowData(overrides: Partial<ProductRowData> = {}): ProductRowData {
  return {
    discountPercent:
      overrides.discountPercent ?? overrides.discount ?? faker.number.int({ min: 0, max: 30 }),
    taxPercent: overrides.taxPercent ?? overrides.tax ?? faker.number.int({ min: 0, max: 28 }),
    adjustmentPercent: overrides.adjustmentPercent ?? faker.number.int({ min: -10, max: 10 }),
    discount:
      overrides.discount ?? overrides.discountPercent ?? faker.number.int({ min: 0, max: 30 }),
    tax: overrides.tax ?? overrides.taxPercent ?? faker.number.int({ min: 0, max: 28 }),
    ...overrides,
  };
}

export function formatDateForCalendarLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
