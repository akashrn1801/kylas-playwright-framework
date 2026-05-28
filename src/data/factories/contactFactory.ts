import { faker } from '@faker-js/faker';

export interface ContactData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  facebook: string;
  twitter: string;
  linkedin: string; // contacts use lowercase 'linkedin' — differs from leads ('linkedIn')
  department: string;
  designation: string;
  subSource: string;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
}

export function generateContactData(
  overrides: Partial<ContactData> = {}
): ContactData {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;

  return {
    firstName,
    lastName,
    email: faker.internet.email({ firstName, lastName }),
    phone:
      faker.helpers.arrayElement(['6', '7', '8', '9']) +
      faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${username}`,
    twitter: `https://twitter.com/${username}`,
    linkedin: `https://linkedin.com/in/${username}`,
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    subSource: faker.helpers.arrayElement([
      'organic',
      'paid',
      'referral',
      'direct',
    ]),
    utmSource: faker.helpers.arrayElement([
      'google',
      'facebook',
      'twitter',
      'email',
    ]),
    utmCampaign: faker.lorem.slug(2),
    utmMedium: faker.helpers.arrayElement([
      'cpc',
      'email',
      'social',
      'banner',
    ]),
    utmContent: faker.lorem.slug(2),
    utmTerm: faker.lorem.word(),
    ...overrides,
  };
}

// WHY: Admin contact data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890_John" will NEVER find
// a contact from a previous test run — guaranteed uniqueness.
export function generateAdminContactData(
  overrides: Partial<ContactData> = {}
): ContactData {
  const timestamp = Date.now().toString();
  const firstName = `ADM${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;

  return {
    firstName,
    lastName,
    email: `adm${timestamp}@testkylas.com`,
    phone:
      faker.helpers.arrayElement(['6', '7', '8', '9']) +
      faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${username}`,
    twitter: `https://twitter.com/${username}`,
    linkedin: `https://linkedin.com/in/${username}`,
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    subSource: 'organic',
    utmSource: 'google',
    utmCampaign: faker.lorem.slug(2),
    utmMedium: 'cpc',
    utmContent: faker.lorem.slug(2),
    utmTerm: faker.lorem.word(),
    ...overrides,
  };
}