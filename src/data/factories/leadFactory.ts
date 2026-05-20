import { faker } from '@faker-js/faker';

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
    facebook: `https://facebook.com/${username}`,
    twitter: `https://twitter.com/${username}`,
    linkedIn: `https://linkedin.com/in/${username}`,
    companyName: faker.company.name(),
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    companyAddress: faker.location.streetAddress(),
    companyCity: faker.location.city(),
    companyState: faker.location.state(),
    companyZipcode: faker.location.zipCode('#####'),
    companyCountry: 'India',
    ...overrides,
  };
}