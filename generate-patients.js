/**
 * Script to generate 50 fake patients for IGS Pharma
 * Uses the setup-data package directly
 */

const fs = require('fs');
const path = require('path');

// Import setup-data package modules
const { faker } = require('./packages/setup-data/node_modules/@faker-js/faker');
const yaml = require('./packages/setup-data/node_modules/js-yaml');

// Set seed for reproducible results
faker.seed(456);

// Load configuration
const config = yaml.load(fs.readFileSync('./setup-data.yml', 'utf8'));

// Common medical conditions
const medicalConditions = [
  'Hypertension',
  'Diabetes Type 2',
  'Diabetes Type 1',
  'Asthma',
  'Arthritis',
  'Migraine',
  'Hypothyroidism',
  'Hyperthyroidism',
  'Depression',
  'Anxiety',
  'COPD',
  'Coronary Artery Disease',
  'Chronic Kidney Disease',
  'Epilepsy',
  'Gastroesophageal Reflux Disease',
  'Irritable Bowel Syndrome',
  'Osteoporosis',
  'Fibromyalgia',
  'Multiple Sclerosis',
  'Parkinson\'s Disease'
];

// Common allergies
const allergies = [
  'Penicillin',
  'Sulfa Drugs',
  'NSAIDs',
  'Aspirin',
  'Peanuts',
  'Tree Nuts',
  'Shellfish',
  'Eggs',
  'Milk',
  'Wheat',
  'Soy',
  'Latex',
  'Dust Mites',
  'Pet Dander',
  'Pollen',
  'Mold',
  'Bee Stings',
  'Iodine',
  'Contrast Dye',
  'None'
];

// Insurance providers
const insuranceProviders = [
  'Blue Cross Blue Shield',
  'Aetna',
  'UnitedHealthcare',
  'Cigna',
  'Humana',
  'Kaiser Permanente',
  'Medicare',
  'Medicaid',
  'Anthem',
  'Centene',
  'Molina Healthcare',
  'WellCare',
  'Health Net',
  'None'
];

// Generate a patient
function generatePatient(index) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const gender = faker.helpers.arrayElement(['Male', 'Female', 'Other']);
  const dateOfBirth = faker.date.birthdate({ min: 1, max: 90 });
  
  // Generate 0-3 medical conditions
  const patientConditions = faker.helpers.arrayElements(
    medicalConditions,
    faker.number.int({ min: 0, max: 3 })
  ).join(', ');
  
  // Generate 0-2 allergies
  const patientAllergies = faker.helpers.arrayElements(
    allergies,
    faker.number.int({ min: 0, max: 2 })
  ).join(', ');
  
  return {
    FirstName: firstName,
    LastName: lastName,
    Email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    Phone: faker.phone.number('###-###-####'),
    DateOfBirth: formatDate(dateOfBirth),
    Gender: gender,
    Address: faker.location.streetAddress(),
    City: faker.location.city(),
    PostalCode: faker.location.zipCode(),
    Country: faker.location.country(),
    InsuranceNumber: faker.helpers.maybe(() => `INS-${faker.string.alphanumeric(8).toUpperCase()}`, { probability: 0.8 }) || '',
    InsuranceProvider: faker.helpers.maybe(() => faker.helpers.arrayElement(insuranceProviders), { probability: 0.8 }) || '',
    Allergies: patientAllergies,
    MedicalConditions: patientConditions,
    DoctorId: faker.helpers.maybe(() => faker.number.int({ min: 1, max: 10 }), { probability: 0.7 }),
    IsActive: true,
    CreatedAt: formatDate(faker.date.past({ years: 2 })),
    UpdatedAt: formatDate(faker.date.recent({ days: 60 }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate 50 patients
const patients = Array.from({ length: 50 }, (_, i) => generatePatient(i));

// Save to file
fs.writeFileSync('patients-generated.json', JSON.stringify(patients, null, 2));
console.log(`✓ Generated 50 patients and saved to patients-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these patients to the database, run:');
console.log('pnpm setup-data import -f patients-generated.json -t Patients');
console.log('\nMake sure your backend server is running before importing.');
