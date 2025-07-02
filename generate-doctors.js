/**
 * Script to generate 15 fake doctors for IGS Pharma
 * Uses the setup-data package directly
 */

const fs = require('fs');
const path = require('path');

// Import setup-data package modules
const { faker } = require('./packages/setup-data/node_modules/@faker-js/faker');
const yaml = require('./packages/setup-data/node_modules/js-yaml');

// Set seed for reproducible results
faker.seed(789);

// Load configuration
const config = yaml.load(fs.readFileSync('./setup-data.yml', 'utf8'));

// Common medical specializations
const specializations = [
  'General Practice',
  'Internal Medicine',
  'Pediatrics',
  'Cardiology',
  'Dermatology',
  'Endocrinology',
  'Gastroenterology',
  'Neurology',
  'Obstetrics and Gynecology',
  'Oncology',
  'Ophthalmology',
  'Orthopedics',
  'Psychiatry',
  'Pulmonology',
  'Radiology',
  'Urology'
];

// Generate a doctor
function generateDoctor(index) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const specialization = faker.helpers.arrayElement(specializations);
  
  return {
    FirstName: firstName,
    LastName: lastName,
    Email: faker.internet.email({ firstName, lastName, provider: 'medcenter.com' }).toLowerCase(),
    Phone: faker.phone.number('###-###-####'),
    Specialization: specialization,
    LicenseNumber: `MD-${faker.string.alphanumeric(8).toUpperCase()}`,
    IsActive: true,
    CreatedAt: formatDate(faker.date.past({ years: 3 })),
    UpdatedAt: formatDate(faker.date.recent({ days: 90 }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate 15 doctors
const doctors = Array.from({ length: 15 }, (_, i) => generateDoctor(i));

// Save to file
fs.writeFileSync('doctors-generated.json', JSON.stringify(doctors, null, 2));
console.log(`✓ Generated 15 doctors and saved to doctors-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these doctors to the database, run:');
console.log('pnpm setup-data import -f doctors-generated.json -t Doctors');
console.log('\nMake sure your backend server is running before importing.');
