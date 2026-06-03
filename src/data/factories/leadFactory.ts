import { faker } from '@faker-js/faker';

export type LeadPipelineStage =
  | 'Open'
  | 'Prospect/Contacted'
  | 'Requirements Gathered'
  | 'Demo/Meeting Conducted'
  | 'Won'
  | 'Closed Unqualified'
  | 'Closed Lost';

export const LEAD_PIPELINE_STAGES: LeadPipelineStage[] = [
  'Open',
  'Prospect/Contacted',
  'Requirements Gathered',
  'Demo/Meeting Conducted',
  'Won',
  'Closed Unqualified',
  'Closed Lost',
];


export interface LeadData {
  firstName: string;
  lastName: string;
  salutation: 'Mr' | 'Mrs' | 'Miss';
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  facebook: string;
  twitter: string;
  linkedIn: string;
  companyName: string;
  department: string;
  designation: string;
  companyAddress: string;
  companyCity: string;
  companyState: string;
  companyZipcode: string;
  companyCountry: string;
  pipelineStage?: LeadPipelineStage;
}

export function generateLeadData(overrides: Partial<LeadData> = {}): LeadData {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    salutation: faker.helpers.arrayElement(['Mr', 'Mrs', 'Miss']),
    email: faker.internet.email({ firstName, lastName }),
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    country: 'India',
    // WHY: Sanitize username — remove special chars that fail URL validation
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedIn: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    companyName: faker.company.name(),
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    companyAddress: faker.location.streetAddress(),
    companyCity: faker.location.city(),
    companyState: faker.location.state(),
    companyZipcode: faker.location.zipCode('#####'),
    companyCountry: 'India',
    pipelineStage: 'Open' as LeadPipelineStage,
    ...overrides,
  };
}

// WHY: Admin lead data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890_John" will NEVER find
// a lead from a previous test run — guaranteed uniqueness.
export function generateAdminLeadData(overrides: Partial<LeadData> = {}): LeadData {
  const timestamp = Date.now().toString();
  const firstName = `ADM${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    salutation: faker.helpers.arrayElement(['Mr', 'Mrs', 'Miss']),
    email: `adm${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    country: 'India',
    // WHY: Sanitize username — remove special chars that fail URL validation
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedIn: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    companyName: faker.company.name(),
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    companyAddress: faker.location.streetAddress(),
    companyCity: faker.location.city(),
    companyState: faker.location.state(),
    companyZipcode: faker.location.zipCode('#####'),
    companyCountry: 'India',
    pipelineStage: 'Open' as LeadPipelineStage,
    ...overrides,
  };
}
