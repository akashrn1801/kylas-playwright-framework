import { faker } from '@faker-js/faker';

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
   discount?: number;      // ← ADD - alias used in specs
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
  billingCountry: string;
  billingZipcode: string;
  sameShippingAsBilling: boolean;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingCountry?: string;
  shippingZipcode?: string;
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
    billingCountry: 'India',
    billingZipcode: faker.string.numeric({ length: 6 }),
  };
}

export function generateQuotationData(overrides: Partial<QuotationData> = {}): QuotationData {
  const ts = Date.now();
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
    ...overrides,
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

export function generateRestrictedQuotationData(overrides: Partial<QuotationData> = {}): QuotationData {
  const ts = Date.now();
  return generateQuotationData({
    quotationNumber: `RES${ts}`,
    summary: `RES${ts} ${faker.lorem.words(3)}`,
    ...overrides,
  });
}

export function generateProductRowData(overrides: Partial<ProductRowData> = {}): ProductRowData {
  return {
    discountPercent: overrides.discountPercent ?? overrides.discount ?? faker.number.int({ min: 0, max: 30 }),
    taxPercent: overrides.taxPercent ?? overrides.tax ?? faker.number.int({ min: 0, max: 28 }),
    adjustmentPercent: overrides.adjustmentPercent ?? faker.number.int({ min: -10, max: 10 }),
    discount: overrides.discount ?? overrides.discountPercent ?? faker.number.int({ min: 0, max: 30 }),
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
