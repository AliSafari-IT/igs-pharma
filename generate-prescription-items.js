/**
 * Script to generate prescription items for IGS Pharma
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

// Common dosages
const commonDosages = [
  '5mg once daily',
  '10mg twice daily',
  '20mg three times daily',
  '25mg every 4-6 hours as needed',
  '50mg at bedtime',
  '100mg every morning',
  '250mg every 8 hours',
  '500mg twice daily with food',
  '1g once daily',
  '2.5mg as directed',
  '75mg every 12 hours',
  '150mg daily'
];

// Common instructions
const commonInstructions = [
  'Take with food to avoid stomach upset',
  'Take on an empty stomach',
  'Do not take with dairy products',
  'Avoid alcohol while taking this medication',
  'May cause drowsiness, use caution when driving',
  'Take with a full glass of water',
  'Store at room temperature away from moisture',
  'Do not crush or chew tablets',
  'May cause sensitivity to sunlight',
  'Complete the full course of treatment',
  'Take at the same time each day',
  'If a dose is missed, take as soon as remembered unless it\'s almost time for the next dose'
];

// Generate a prescription item
function generatePrescriptionItem(prescriptionId) {
  return {
    PrescriptionId: prescriptionId,
    ProductId: faker.number.int({ min: 1, max: 100 }), // Assuming 100 products
    Quantity: faker.number.int({ min: 1, max: 90 }),
    Dosage: faker.helpers.arrayElement(commonDosages),
    Instructions: faker.helpers.arrayElement(commonInstructions),
    DaysSupply: faker.number.int({ min: 7, max: 90 }),
    IsGenericAllowed: faker.datatype.boolean(0.8), // 80% chance of allowing generic
    CreatedAt: formatDate(faker.date.recent({ days: 60 }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate 1-3 items for each of the 30 prescriptions
const prescriptionItems = [];
for (let prescriptionId = 1; prescriptionId <= 30; prescriptionId++) {
  const itemCount = faker.number.int({ min: 1, max: 3 });
  for (let i = 0; i < itemCount; i++) {
    prescriptionItems.push(generatePrescriptionItem(prescriptionId));
  }
}

// Save to file
fs.writeFileSync('prescription-items-generated.json', JSON.stringify(prescriptionItems, null, 2));
console.log(`✓ Generated ${prescriptionItems.length} prescription items and saved to prescription-items-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these prescription items to the database, run:');
console.log('pnpm setup-data import -f prescription-items-generated.json -t PrescriptionItems');
console.log('\nMake sure your backend server is running and prescriptions are imported before importing prescription items.');
