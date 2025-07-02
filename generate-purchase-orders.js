/**
 * Script to generate 25 fake purchase orders for IGS Pharma
 * Uses the setup-data package directly
 */

const fs = require('fs');
const path = require('path');

// Import setup-data package modules
const { faker } = require('./packages/setup-data/node_modules/@faker-js/faker');
const yaml = require('./packages/setup-data/node_modules/js-yaml');

// Set seed for reproducible results
faker.seed(678);

// Load configuration
const config = yaml.load(fs.readFileSync('./setup-data.yml', 'utf8'));

// Purchase order status enum
const purchaseOrderStatus = {
  'Pending': 0,
  'Approved': 1,
  'Ordered': 2,
  'Shipped': 3,
  'Delivered': 4,
  'Cancelled': 5,
  'OnHold': 6
};

// Generate a purchase order
function generatePurchaseOrder(index) {
  const orderDate = faker.date.past({ years: 1 });
  const status = faker.helpers.weightedArrayElement([
    { weight: 3, value: 'Delivered' },
    { weight: 2, value: 'Approved' },
    { weight: 2, value: 'Ordered' },
    { weight: 1, value: 'Pending' },
    { weight: 1, value: 'Shipped' },
    { weight: 0.5, value: 'Cancelled' },
    { weight: 0.5, value: 'OnHold' }
  ]);
  
  // Calculate dates based on status
  let expectedDeliveryDate = new Date(orderDate);
  expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + faker.number.int({ min: 7, max: 30 }));
  
  let actualDeliveryDate = null;
  if (status === 'Delivered') {
    actualDeliveryDate = new Date(expectedDeliveryDate);
    // Actual delivery could be before, on, or after expected date
    const daysOffset = faker.number.int({ min: -3, max: 5 });
    actualDeliveryDate.setDate(actualDeliveryDate.getDate() + daysOffset);
  }
  
  // Calculate financial values
  const subTotal = parseFloat(faker.finance.amount(500, 10000, 2));
  const taxRate = 0.08; // 8% tax rate
  const taxAmount = parseFloat((subTotal * taxRate).toFixed(2));
  const totalAmount = parseFloat((subTotal + taxAmount).toFixed(2));
  
  return {
    OrderNumber: `PO-${faker.string.alphanumeric(8).toUpperCase()}`,
    OrderDate: formatDate(orderDate),
    ExpectedDeliveryDate: formatDate(expectedDeliveryDate),
    ActualDeliveryDate: actualDeliveryDate ? formatDate(actualDeliveryDate) : null,
    SubTotal: subTotal,
    TaxAmount: taxAmount,
    TotalAmount: totalAmount,
    Status: purchaseOrderStatus[status],
    Notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.7 }) || '',
    SupplierId: faker.number.int({ min: 1, max: 20 }), // Assuming 20 suppliers
    UserId: faker.number.int({ min: 1, max: 20 }), // Assuming 20 users
    CreatedAt: formatDate(orderDate),
    UpdatedAt: formatDate(faker.date.between({ from: orderDate, to: new Date() }))
  };
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date ? date.toISOString().slice(0, 19).replace('T', ' ') : null;
}

// Generate 25 purchase orders
const purchaseOrders = Array.from({ length: 25 }, (_, i) => generatePurchaseOrder(i));

// Save to file
fs.writeFileSync('purchase-orders-generated.json', JSON.stringify(purchaseOrders, null, 2));
console.log(`✓ Generated 25 purchase orders and saved to purchase-orders-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these purchase orders to the database, run:');
console.log('pnpm setup-data import -f purchase-orders-generated.json -t PurchaseOrders');
console.log('\nMake sure your backend server is running and suppliers are imported before importing purchase orders.');
