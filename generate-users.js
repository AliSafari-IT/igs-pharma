/**
 * Script to generate 20 fake users for IGS Pharma
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

// User roles from the enum
const userRoles = ['Admin', 'Manager', 'Pharmacist', 'Technician', 'Cashier'];

// Common permissions for different roles
const rolePermissions = {
  Admin: [
    'users.read', 'users.write', 'users.view',
    'products.read', 'products.write', 'products.view',
    'sales.read', 'sales.write', 'sales.view',
    'inventory.read', 'inventory.write', 'inventory.view',
    'settings.read', 'settings.write', 'settings.view',
    'patients.read', 'patients.write', 'patients.view',
    'prescriptions.read', 'prescriptions.write', 'prescriptions.view'
  ],
  Manager: [
    'products.read', 'products.write', 'products.view',
    'sales.read', 'sales.write', 'sales.view',
    'inventory.read', 'inventory.write', 'inventory.view',
    'patients.read', 'patients.write', 'patients.view',
    'prescriptions.read', 'prescriptions.write', 'prescriptions.view'
  ],
  Pharmacist: [
    'products.read', 'products.view',
    'sales.read', 'sales.write', 'sales.view',
    'inventory.read', 'inventory.view',
    'patients.read', 'patients.view',
    'prescriptions.read', 'prescriptions.write', 'prescriptions.view'
  ],
  Technician: [
    'products.read', 'products.view',
    'inventory.read', 'inventory.write', 'inventory.view',
    'patients.read', 'patients.view'
  ],
  Cashier: [
    'products.read', 'products.view',
    'sales.read', 'sales.write', 'sales.view'
  ]
};

// Generate a user
function generateUser(index) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = faker.internet.userName({ firstName, lastName }).toLowerCase();
  const role = userRoles[faker.number.int({ min: 0, max: userRoles.length - 1 })];
  
  return {
    FirstName: firstName,
    LastName: lastName,
    Email: faker.internet.email({ firstName, lastName, provider: 'igspharma.com' }).toLowerCase(),
    Username: username,
    PasswordHash: '$2a$11$ij3DjFxKkQI/kg0jZ.nJA.ZXCJlVjMpMGZxtJ7BzMDBBFMz9WvG9e', // Default hash for "Password123!"
    Phone: faker.phone.number('###-###-####'),
    Department: faker.helpers.arrayElement(['Pharmacy', 'Inventory', 'Sales', 'Management', 'Administration']),
    // Convert role to integer value based on UserRole enum
    Role: roleToInt(role),
    EmployeeId: `EMP-${faker.string.alphanumeric(6).toUpperCase()}`,
    CardId: faker.string.alphanumeric(8).toUpperCase(),
    CardExpiryDate: formatDate(faker.date.future({ years: 2 })),
    // Always provide a string for LicenseNumber (empty if not a pharmacist)
    LicenseNumber: role === 'Pharmacist' ? `LIC-${faker.string.alphanumeric(8).toUpperCase()}` : '',
    // Store permissions as a string
    Permissions: JSON.stringify(rolePermissions[role] || []),
    IsActive: true,
    LastLoginAt: formatDate(faker.date.recent({ days: 30 })),
    CreatedAt: formatDate(faker.date.past({ years: 1 })),
    UpdatedAt: formatDate(faker.date.recent({ days: 10 }))
  };
}

// Convert role string to integer based on UserRole enum
function roleToInt(role) {
  const roleMap = {
    'admin': 0,
    'manager': 1,
    'pharmacist': 2,
    'technician': 3,
    'cashier': 4
  };
  
  return roleMap[role.toLowerCase()] || 2; // Default to Pharmacist (2) if not found
}

// Format date to MySQL format (YYYY-MM-DD HH:MM:SS)
function formatDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');

}

// Generate 20 users
const users = Array.from({ length: 20 }, (_, i) => generateUser(i));

// Save to file
fs.writeFileSync('users-generated.json', JSON.stringify(users, null, 2));
console.log(`✓ Generated 20 users and saved to users-generated.json`);

// Save to file and provide instructions for importing
console.log('\nTo import these users to the database, run:');
console.log('pnpm setup-data import -f users-generated.json -t Users');
console.log('\nMake sure your backend server is running before importing.');

