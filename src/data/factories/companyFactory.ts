import { faker } from '@faker-js/faker';

// WHY: these are the exact values rendered by the numberOfEmployees picklist
// in the app — selecting outside this set will cause option-not-found failures
export const NUMBER_OF_EMPLOYEES_OPTIONS = [
  '1-4',
  '5-9',
  '10-19',
  '20-49',
  '50-99',
  '100-249',
  '250-499',
  '500-999',
  '1000+',
] as const;
export type NumberOfEmployees = (typeof NUMBER_OF_EMPLOYEES_OPTIONS)[number];

// WHY: these are the exact values rendered by the industry picklist
export const INDUSTRY_OPTIONS = [
  'Accounting',
  'Airlines/Aviation',
  'Alternative Dispute Resolution',
  'Alternative Medicine',
  'Animation',
  'Apparel & Fashion',
  'Architecture & Planning',
  'Arts and Crafts',
  'Automotive',
  'Aviation & Aerospace',
] as const;

export type Industry = (typeof INDUSTRY_OPTIONS)[number];

// WHY: these are the exact values rendered by the businessType picklist
export const BUSINESS_TYPE_OPTIONS = [
  'Analyst',
  'Competitor',
  'Customer',
  'Integrator',
  'Investor',
  'Partner',
  'Press',
  'Prospect',
  'Reseller',
  'Other',
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_OPTIONS)[number];

export interface CompanyData {
  name: string;
  numberOfEmployees: NumberOfEmployees;
  industry: Industry;
  businessType: BusinessType;
  annualRevenue: number;
  website: string;
  uniqueText1: string;
  uniqueText2: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  facebook: string;
  twitter: string;
  linkedIn: string; // companies use 'linkedIn' (capital N) — same as leads
}

export function generateCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const companyName = `${faker.company.name()}-${Date.now()}`;
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');

  return {
    name: companyName,
    numberOfEmployees: faker.helpers.arrayElement(NUMBER_OF_EMPLOYEES_OPTIONS),
    industry: faker.helpers.arrayElement(INDUSTRY_OPTIONS),
    businessType: faker.helpers.arrayElement(BUSINESS_TYPE_OPTIONS),
    annualRevenue: faker.number.int({ min: 100000, max: 10000000 }),
    website: `https://www.${slug}.com`,
    uniqueText1: `${faker.lorem.word()}_${Date.now()}`,
    uniqueText2: `${faker.lorem.word()}_${Date.now() + 1}`,
    email: faker.internet.email(),
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${slug}`,
    twitter: `https://twitter.com/${slug}`,
    linkedIn: `https://linkedin.com/company/${slug}`,
    ...overrides,
  };
}

// WHY: Admin company data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890 Corp" will NEVER find
// a company from a previous test run — guaranteed uniqueness.
export function generateAdminCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const timestamp = Date.now().toString();
  const name = `ADM${timestamp} Corp`;
  const slug = `adm${timestamp}corp`;

  return {
    name,
    numberOfEmployees: '100-249',
    industry: 'Accounting',
    businessType: 'Prospect',
    annualRevenue: faker.number.int({ min: 100000, max: 10000000 }),
    website: `https://www.${slug}.com`,
    uniqueText1: `${faker.lorem.word()}_${Date.now()}`,
    uniqueText2: `${faker.lorem.word()}_${Date.now() + 1}`,
    email: `adm${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${slug}`,
    twitter: `https://twitter.com/${slug}`,
    linkedIn: `https://linkedin.com/company/${slug}`,
    ...overrides,
  };
}
