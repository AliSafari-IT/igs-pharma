/**
 * Script to generate 40 fake sales for IGS Pharma
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

// Payment method enum
const paymentMethod = {
  'Cash': 0,
  'CreditCard': 1,
  'DebitCard': 2,
  'Insurance': 3,
  'BankTransfer': 4,
  'MobilePay': 5,
  'Check': 6
};

// Sale status enum
const saleStatus = {
  'Pending': 0,
  'Completed': 1,
  'Refunded': 2,
  'Cancelled': 3,
  'OnHold': 4
};

// Generate a sale
function generateSale(index) {
  const saleDate = faker.date.recent({ days: 90 });
  const status = faker.helpers.weightedArrayElement([
    { weight: 8, value: 'Completed' },
    { weight: 1, value: 'Pending' },
    { weight: 0.5, value: 'Refunded' },
    { weight: 0.3, value: 'Cancelled' },
    { weight: 0.2, value: 'OnHold' }
  ]);
  
  const payment = faker.helpers.weightedArrayElement([
    { weight: 3, value: 'CreditCard' },
    { weight: 3, value: 'DebitCard' },
    { weight: 2, value: 'Cash' },
    { weight: 1, value: 'Insurance' },
    { weight: 0.5, value: 'MobilePay' },
    { weight: 0.3, value: 'BankTransfer' },
    { weight: 0.2, value: 'Check' }
  ]);
  
  // Calculate financial values
  const subTotal = parseFloat(faker.finance.amount(10, 500, 2));
  const taxRate = 0.08; // 8% tax rate
  const taxAmount = parseFloat((subTotal * taxRate).toFixed(2));
  const discountAmount = parseFloat(faker.finance.amount(0, subTotal * 0.1, 2)); // Up to 10% discount
  const totalAmount = parseFloat((subTotal + taxAmount - discountAmount).toFixed(2));
  
  // Generate payment reference based on payment method
  let paymentReference = '';
  if (payment === 'CreditCard' || payment === 'DebitCard') {
    paymentReference = `CARD-${faker.finance.creditCardNumber('####-####-####-####').slice(-4)}`;
  } else if (payment === 'Insurance') {
    paymentReference = `INS-${faker.string.alphanumeric(8).toUpperCase()}`;
  } else if (payment === 'BankTransfer') {
    paymentReference = `TRF-${faker.string.alphanumeric(10).toUpperCase()}`;
  } else if (payment === 'Check') {
    paymentReference = `CHK-${faker.string.numeric(6)}`;
  }
  
  return {
    SaleNumber: `S-${faker.string.alphanumeric(8).toUpperCase()}`,
    SaleDate: formatDate(saleDate),
    SubTotal: subTotal,
    TaxAmount: taxAmount,
    DiscountAmount: discountAmount,
    TotalAmount: totalAmount,
    PaymentMethod: paymentMethod[payment],
    PaymentReference: paymentReference,
    Status: saleStatus[status],
    Notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }) || '',
    PatientId: faker.helpers.maybe(() => faker.number.int({ min: 1, max: 50 }), { probability: 0.7 }), // 70% chance of having a patient
    UserId: faker.number.int({ min: 1, max: 20 }), // Assuming 20 users
    CreatedAt: formatDate(saleDate),
    UpdatedAt: formatDate(saleDate)
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

// Generate 40 sales
const sales = Array.from({ length: 40 }, (_, i) => generateSale(i));

// Save to file
fs.writeFileSync('sales-generated.json', JSON.stringify(sales, null, 2));
console.log(`✓ Generated 40 sales and saved to sales-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these sales to the database, run:');
console.log('pnpm setup-data import -f sales-generated.json -t Sales');
console.log('\nMake sure your backend server is running and patients/users are imported before importing sales.');
