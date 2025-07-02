/**
 * Script to generate sale items for IGS Pharma
 * Uses the setup-data package directly
 */

const fs = require('fs');
const path = require('path');

// Import setup-data package modules
const { faker } = require('./packages/setup-data/node_modules/@faker-js/faker');
const yaml = require('./packages/setup-data/node_modules/js-yaml');

// Set seed for reproducible results
faker.seed(890);

// Load configuration
const config = yaml.load(fs.readFileSync('./setup-data.yml', 'utf8'));

// Generate a sale item
function generateSaleItem(saleId) {
  const quantity = faker.number.int({ min: 1, max: 5 });
  const unitPrice = parseFloat(faker.finance.amount(5, 100, 2));
  const discountAmount = parseFloat(faker.finance.amount(0, unitPrice * 0.15, 2)); // Up to 15% discount per item
  const totalPrice = parseFloat(((unitPrice * quantity) - discountAmount).toFixed(2));
  
  return {
    SaleId: saleId,
    ProductId: faker.number.int({ min: 1, max: 100 }), // Assuming 100 products
    Quantity: quantity,
    UnitPrice: unitPrice,
    DiscountAmount: discountAmount,
    TotalPrice: totalPrice,
    CreatedAt: formatDate(faker.date.recent({ days: 90 }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Generate 1-5 items for each of the 40 sales
const saleItems = [];
for (let saleId = 1; saleId <= 40; saleId++) {
  const itemCount = faker.number.int({ min: 1, max: 5 });
  for (let i = 0; i < itemCount; i++) {
    saleItems.push(generateSaleItem(saleId));
  }
}

// Save to file
fs.writeFileSync('sale-items-generated.json', JSON.stringify(saleItems, null, 2));
console.log(`✓ Generated ${saleItems.length} sale items and saved to sale-items-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these sale items to the database, run:');
console.log('pnpm setup-data import -f sale-items-generated.json -t SaleItems');
console.log('\nMake sure your backend server is running and sales/products are imported before importing sale items.');
