/**
 * Script to generate 20 fake suppliers for IGS Pharma
 * Uses the setup-data package directly
 */

const fs = require('fs');
const path = require('path');

// Import setup-data package modules
const { faker } = require('./packages/setup-data/node_modules/@faker-js/faker');
const yaml = require('./packages/setup-data/node_modules/js-yaml');

// Set seed for reproducible results
faker.seed(567);

// Load configuration
const config = yaml.load(fs.readFileSync('./setup-data.yml', 'utf8'));

// Common pharmaceutical supplier name components
const supplierPrefixes = [
  'Pharma', 'Med', 'Health', 'Life', 'Bio', 'Care', 'Cure', 'Global', 'United', 'National',
  'Advanced', 'Premier', 'Elite', 'Prime', 'Superior', 'Quality', 'Reliable', 'Trusted'
];

const supplierSuffixes = [
  'Pharmaceuticals', 'Medical Supplies', 'Healthcare', 'Laboratories', 'Biotech', 'Distributors',
  'Solutions', 'Group', 'Industries', 'Corp', 'Inc', 'LLC', 'Partners', 'Associates', 'Supplies'
];

// Generate a supplier name
function generateSupplierName() {
  if (faker.number.int({ min: 1, max: 10 }) > 8) {
    // Sometimes use a person's name
    return `${faker.person.lastName()} ${faker.helpers.arrayElement(supplierSuffixes)}`;
  } else {
    // Usually use a company-style name
    return `${faker.helpers.arrayElement(supplierPrefixes)}${faker.helpers.arrayElement(supplierSuffixes)}`;
  }
}

// Generate a supplier
function generateSupplier(index) {
  const name = generateSupplierName();
  const contactPerson = `${faker.person.firstName()} ${faker.person.lastName()}`;
  
  return {
    Name: name,
    ContactPerson: contactPerson,
    Email: faker.internet.email({ firstName: contactPerson.split(' ')[0], lastName: contactPerson.split(' ')[1], provider: name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com' }).toLowerCase(),
    Phone: faker.phone.number('###-###-####'),
    Address: faker.location.streetAddress(),
    City: faker.location.city(),
    PostalCode: faker.location.zipCode(),
    Country: faker.location.country(),
    Website: `https://www.${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
    PaymentTerms: faker.helpers.arrayElement(['Net 30', 'Net 60', 'Net 90', 'COD', 'Prepaid']),
    IsActive: faker.datatype.boolean(0.9), // 90% chance of being active
    CreatedAt: formatDate(faker.date.past({ years: 2 })),
    UpdatedAt: formatDate(faker.date.recent({ days: 60 }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate 20 suppliers
const suppliers = Array.from({ length: 20 }, (_, i) => generateSupplier(i));

// Save to file
fs.writeFileSync('suppliers-generated.json', JSON.stringify(suppliers, null, 2));
console.log(`✓ Generated 20 suppliers and saved to suppliers-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these suppliers to the database, run:');
console.log('pnpm setup-data import -f suppliers-generated.json -t Suppliers');
console.log('\nMake sure your backend server is running before importing.');
