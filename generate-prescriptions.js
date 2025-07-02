/**
 * Script to generate 30 fake prescriptions for IGS Pharma
 * Uses the setup-data package directly
 */

const fs = require('fs');
const path = require('path');

// Import setup-data package modules
const { faker } = require('./packages/setup-data/node_modules/@faker-js/faker');
const yaml = require('./packages/setup-data/node_modules/js-yaml');

// Set seed for reproducible results
faker.seed(123);

// Load configuration
const config = yaml.load(fs.readFileSync('./setup-data.yml', 'utf8'));

// Common prescription instructions
const commonInstructions = [
  'Take once daily with food',
  'Take twice daily with water',
  'Take three times daily after meals',
  'Take as needed for pain, not more than 4 times daily',
  'Take on an empty stomach 30 minutes before breakfast',
  'Take at bedtime',
  'Apply topically to affected area twice daily',
  'Take with a full glass of water',
  'Do not take with dairy products',
  'Dissolve under tongue as needed for chest pain'
];

// Common dosages
const commonDosages = [
  '5mg',
  '10mg',
  '20mg',
  '25mg',
  '50mg',
  '100mg',
  '250mg',
  '500mg',
  '1g',
  '2.5mg',
  '75mg',
  '150mg'
];

// Prescription status enum
const prescriptionStatus = {
  'Pending': 0,
  'Filled': 1,
  'Refilled': 2,
  'Completed': 3,
  'Cancelled': 4,
  'Expired': 5
};

// Generate a prescription
function generatePrescription(index) {
  const prescriptionDate = faker.date.recent({ days: 60 });
  const status = faker.helpers.weightedArrayElement([
    { weight: 3, value: 'Filled' },
    { weight: 2, value: 'Pending' },
    { weight: 2, value: 'Refilled' },
    { weight: 1, value: 'Completed' },
    { weight: 1, value: 'Cancelled' },
    { weight: 1, value: 'Expired' }
  ]);
  
  const totalRefills = faker.number.int({ min: 0, max: 5 });
  const refillsRemaining = status === 'Completed' || status === 'Expired' ? 0 : 
                          faker.number.int({ min: 0, max: totalRefills });
  
  const filledDate = status === 'Pending' ? null : 
                    faker.date.between({ 
                      from: prescriptionDate, 
                      to: new Date(prescriptionDate.getTime() + 7 * 24 * 60 * 60 * 1000) 
                    });
  
  return {
    PrescriptionNumber: `RX-${faker.string.alphanumeric(8).toUpperCase()}`,
    PrescriptionDate: formatDate(prescriptionDate),
    DoctorName: `Dr. ${faker.person.lastName()}`,
    DoctorLicense: `MD-${faker.string.alphanumeric(6).toUpperCase()}`,
    DoctorPhone: faker.phone.number('###-###-####'),
    Instructions: faker.helpers.arrayElement(commonInstructions),
    Status: prescriptionStatus[status],
    FilledDate: filledDate ? formatDate(filledDate) : null,
    RefillsRemaining: refillsRemaining,
    TotalRefills: totalRefills,
    IsActive: status !== 'Cancelled' && status !== 'Expired',
    PatientId: faker.number.int({ min: 1, max: 50 }), // Assuming 50 patients
    CreatedAt: formatDate(prescriptionDate),
    UpdatedAt: formatDate(faker.date.recent({ days: 30 }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

// Generate 30 prescriptions
const prescriptions = Array.from({ length: 30 }, (_, i) => generatePrescription(i));

// Save to file
fs.writeFileSync('prescriptions-generated.json', JSON.stringify(prescriptions, null, 2));
console.log(`✓ Generated 30 prescriptions and saved to prescriptions-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these prescriptions to the database, run:');
console.log('pnpm setup-data import -f prescriptions-generated.json -t Prescriptions');
console.log('\nMake sure your backend server is running before importing.');
