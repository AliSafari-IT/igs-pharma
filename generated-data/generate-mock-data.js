/**
 * Simple Mock Data Generator
 * 
 * Generates basic mock data for all entities in the IGS Pharma system
 * without relying on external libraries
 */

const fs = require('fs');
const path = require('path');

// Helper functions for generating random data
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(array) {
  return array[randomInt(0, array.length - 1)];
}

function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(randomInt(0, chars.length - 1));
  }
  return result;
}

// Generate a random date between 2024-01-01 and 2025-07-02
function randomDate() {
  try {
    const start = new Date(2024, 0, 1).getTime();
    const end = new Date(2025, 6, 2).getTime();
    const date = new Date(start + Math.random() * (end - start));
    return date.toISOString().split('T')[0] + ' ' + 
      date.toTimeString().split(' ')[0].substring(0, 8);
  } catch (error) {
    console.error('Error generating random date:', error);
    return '2025-01-01 12:00:00'; // Fallback date
  }
}

function randomEmail() {
  const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'example.com'];
  return randomString(8) + '@' + randomElement(domains);
}

function randomPhone() {
  return `${randomInt(100, 999)}-${randomInt(100, 999)}-${randomInt(1000, 9999)}`;
}

function randomBoolean() {
  return Math.random() > 0.5;
}

function randomDecimal(min, max) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

function randomName() {
  const firstNames = ['John', 'Jane', 'Michael', 'Emma', 'William', 'Olivia', 'James', 'Sophia', 'Robert', 'Emily'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson'];
  return randomElement(firstNames) + ' ' + randomElement(lastNames);
}

function randomFirstName() {
  const names = ['John', 'Jane', 'Michael', 'Emma', 'William', 'Olivia', 'James', 'Sophia', 'Robert', 'Emily', 
               'David', 'Sarah', 'Joseph', 'Elizabeth', 'Thomas', 'Margaret', 'Charles', 'Jennifer', 'Daniel', 'Lisa'];
  return randomElement(names);
}

function randomLastName() {
  const names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson', 
               'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Hernandez', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White'];
  return randomElement(names);
}

function randomUsername() {
  return randomString(randomInt(5, 8)) + randomInt(10, 99);
}

// Generate Categories (20 items)
function generateCategories() {
  console.log('Generating categories...');
  const categories = [];
  for (let i = 0; i < 20; i++) {
    const category = {
      Id: null,
      Name: randomString(randomInt(4, 10)),
      Description: randomString(randomInt(20, 50)),
      IsActive: randomBoolean(),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    };
    console.log(`Generated category ${i+1}:`, category.Name);
    categories.push(category);
  }
  console.log(`Total categories generated: ${categories.length}`);
  return categories;
}

// Generate Doctors (20 items)
function generateDoctors() {
  const doctors = [];
  const usedEmails = new Set();
  
  for (let i = 0; i < 20; i++) {
    let email = randomEmail();
    
    // Ensure email is unique
    while (usedEmails.has(email)) {
      email = randomEmail();
    }
    usedEmails.add(email);
    
    doctors.push({
      Id: null,
      FirstName: randomFirstName(),
      LastName: randomLastName(),
      Email: email,
      Phone: randomPhone(),
      Specialization: randomString(randomInt(10, 20)),
      LicenseNumber: randomString(randomInt(8, 15)),
      IsActive: randomBoolean(),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return doctors;
}

// Generate Users (20 items)
function generateUsers() {
  const users = [];
  const usedEmails = new Set();
  const usedUsernames = new Set();
  
  for (let i = 0; i < 20; i++) {
    let email = randomEmail();
    let username = randomUsername();
    
    // Ensure email and username are unique
    while (usedEmails.has(email)) {
      email = randomEmail();
    }
    usedEmails.add(email);
    
    while (usedUsernames.has(username)) {
      username = randomUsername();
    }
    usedUsernames.add(username);
    
    // Generate random permissions
    const permissionOptions = [
      "read:products", "write:products", 
      "read:categories", "write:categories",
      "manage:users", "admin"
    ];
    
    const permissions = [];
    const permCount = randomInt(1, 4);
    for (let j = 0; j < permCount; j++) {
      const perm = randomElement(permissionOptions);
      if (!permissions.includes(perm)) {
        permissions.push(perm);
      }
    }
    
    users.push({
      Id: null,
      FirstName: randomFirstName(),
      LastName: randomLastName(),
      Email: email,
      Username: username,
      PasswordHash: randomString(8),
      Phone: randomPhone(),
      Department: randomString(randomInt(8, 15)),
      Role: randomInt(1, 3),
      EmployeeId: randomString(randomInt(5, 10)),
      CardId: randomString(randomInt(8, 12)),
      CardExpiryDate: null,
      LicenseNumber: randomString(randomInt(8, 15)),
      IsActive: randomBoolean(),
      LastLoginAt: randomDate(),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate(),
      Permissions: JSON.stringify(permissions)
    });
  }
  return users;
}

// Generate Products (20 items)
function generateProducts() {
  const products = [];
  for (let i = 0; i < 20; i++) {
    products.push({
      Id: null,
      Name: randomString(randomInt(5, 15)),
      Description: randomString(randomInt(20, 100)),
      SKU: randomString(8).toUpperCase(),
      Barcode: randomInt(1000000000000, 9999999999999).toString(),
      CategoryId: randomInt(1, 20),
      PurchasePrice: parseFloat(randomDecimal(5, 100)),
      SalePrice: parseFloat(randomDecimal(10, 200)),
      ReorderLevel: randomInt(5, 50),
      CurrentStock: randomInt(0, 100),
      Manufacturer: randomString(randomInt(5, 15)),
      ExpiryDate: randomDate(),
      BatchNumber: randomString(8),
      IsActive: randomBoolean(),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return products;
}

// Generate Patients (20 items)
function generatePatients() {
  const patients = [];
  for (let i = 0; i < 20; i++) {
    patients.push({
      Id: null,
      FirstName: randomFirstName(),
      LastName: randomLastName(),
      Email: randomEmail(),
      Phone: randomPhone(),
      Address: randomString(randomInt(15, 30)),
      DateOfBirth: randomDate().split(' ')[0],
      Gender: randomElement(['Male', 'Female', 'Other']),
      InsuranceProvider: randomString(randomInt(5, 15)),
      InsuranceNumber: randomString(10),
      MedicalHistory: randomString(randomInt(20, 100)),
      DoctorId: randomBoolean() ? randomInt(1, 20) : null,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return patients;
}

// Generate Suppliers (20 items)
function generateSuppliers() {
  const suppliers = [];
  for (let i = 0; i < 20; i++) {
    suppliers.push({
      Id: null,
      Name: randomString(randomInt(5, 15)),
      ContactPerson: randomFirstName() + ' ' + randomLastName(),
      Email: randomEmail(),
      Phone: randomPhone(),
      Address: randomString(randomInt(15, 30)),
      TaxId: randomString(10),
      PaymentTerms: randomElement(['Net 30', 'Net 60', 'Net 90']),
      IsActive: randomBoolean(),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return suppliers;
}

// Generate Settings (20 items)
function generateSettings() {
  const settings = [];
  for (let i = 0; i < 20; i++) {
    settings.push({
      Id: null,
      Key: randomString(5) + randomInt(100),
      Value: randomString(randomInt(10, 20)),
      Description: randomString(randomInt(20, 50)),
      Group: randomElement(['System', 'User', 'Notification', 'Payment']),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return settings;
}

// Generate Prescriptions (20 items)
function generatePrescriptions() {
  const prescriptions = [];
  for (let i = 0; i < 20; i++) {
    prescriptions.push({
      Id: null,
      PatientId: randomInt(1, 20),
      DoctorId: randomInt(1, 20),
      PrescriptionDate: randomDate(),
      Notes: randomString(randomInt(20, 50)),
      Status: randomElement(['New', 'Processing', 'Completed', 'Cancelled']),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return prescriptions;
}

// Generate Prescription Items (20 items)
function generatePrescriptionItems() {
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push({
      Id: null,
      PrescriptionId: randomInt(1, 20),
      ProductId: randomInt(1, 20),
      Quantity: randomInt(1, 10),
      Dosage: randomString(randomInt(5, 15)),
      Instructions: randomString(randomInt(10, 30)),
      Duration: randomInt(1, 30) + ' days',
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return items;
}

// Generate Sales (20 items)
function generateSales() {
  const sales = [];
  for (let i = 0; i < 20; i++) {
    sales.push({
      Id: null,
      PatientId: randomInt(1, 20),
      UserId: randomInt(1, 20),
      SaleDate: randomDate(),
      TotalAmount: parseFloat(randomDecimal(10, 500)),
      PaymentMethod: randomElement(['Cash', 'Credit Card', 'Insurance']),
      PaymentStatus: randomElement(['Paid', 'Pending', 'Failed']),
      Notes: randomString(randomInt(10, 30)),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return sales;
}

// Generate Sale Items (20 items)
function generateSaleItems() {
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push({
      Id: null,
      SaleId: randomInt(1, 20),
      ProductId: randomInt(1, 20),
      Quantity: randomInt(1, 5),
      UnitPrice: parseFloat(randomDecimal(5, 100)),
      Discount: parseFloat(randomDecimal(0, 10)),
      Total: parseFloat(randomDecimal(10, 200)),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return items;
}

// Generate Purchase Orders (20 items)
function generatePurchaseOrders() {
  const orders = [];
  for (let i = 0; i < 20; i++) {
    orders.push({
      Id: null,
      SupplierId: randomInt(1, 20),
      UserId: randomInt(1, 20),
      OrderDate: randomDate(),
      ExpectedDeliveryDate: randomDate(),
      Status: randomElement(['Pending', 'Approved', 'Shipped', 'Delivered', 'Cancelled']),
      TotalAmount: parseFloat(randomDecimal(100, 5000)),
      Notes: randomString(randomInt(10, 30)),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return orders;
}

// Generate Inventory Transactions (20 items)
function generateInventoryTransactions() {
  const transactions = [];
  for (let i = 0; i < 20; i++) {
    transactions.push({
      Id: null,
      ProductId: randomInt(1, 20),
      TransactionType: randomElement(['Purchase', 'Sale', 'Return', 'Adjustment']),
      Quantity: randomInt(1, 50),
      ReferenceId: randomString(8),
      Notes: randomString(randomInt(10, 30)),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return transactions;
}

// Main function starts here

// Main function to generate all data
function generateAllData() {
  console.log('Starting mock data generation...');
  const dataDir = path.join(__dirname);
  
  // Ensure the directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Test random functions to ensure they work
  console.log('Testing random functions:');
  console.log('- randomString:', randomString(5));
  console.log('- randomInt:', randomInt(1, 10));
  console.log('- randomDate:', randomDate());
  console.log('- randomEmail:', randomEmail());
  
  // Generate and save data for each entity
  const entities = [
    { name: 'Categories', generator: generateCategories },
    { name: 'Doctors', generator: generateDoctors },
    { name: 'Users', generator: generateUsers },
    { name: 'Products', generator: generateProducts },
    { name: 'Patients', generator: generatePatients },
    { name: 'Suppliers', generator: generateSuppliers },
    { name: 'Settings', generator: generateSettings },
    { name: 'Prescriptions', generator: generatePrescriptions },
    { name: 'PrescriptionItems', generator: generatePrescriptionItems },
    { name: 'Sales', generator: generateSales },
    { name: 'SaleItems', generator: generateSaleItems },
    { name: 'PurchaseOrders', generator: generatePurchaseOrders },
    { name: 'InventoryTransactions', generator: generateInventoryTransactions }
  ];
  
  entities.forEach(entity => {
    try {
      console.log(`\n--- Generating ${entity.name} ---`);
      const data = entity.generator();
      
      if (!Array.isArray(data)) {
        console.error(`Error: ${entity.name} generator did not return an array!`);
        return;
      }
      
      if (data.length === 0) {
        console.error(`Warning: ${entity.name} generator returned an empty array!`);
      }
      
      // Ensure consistent naming - always use singular form
      const entityName = entity.name.toLowerCase();
      const singularName = entityName.endsWith('ies') ? 
        entityName.replace(/ies$/, 'y') : 
        entityName.endsWith('s') ? entityName.slice(0, -1) : entityName;
      
      const fileName = `${singularName}-generated.json`;
      const filePath = path.join(dataDir, fileName);
      
      // Debug file path and data
      console.log(`Writing to file: ${filePath}`);
      console.log(`Data length: ${data.length} items`);
      
      const jsonData = JSON.stringify(data, null, 2);
      fs.writeFileSync(filePath, jsonData);
      
      // Verify file was written correctly
      const fileExists = fs.existsSync(filePath);
      const fileSize = fileExists ? fs.statSync(filePath).size : 0;
      console.log(`File written: ${fileExists}, size: ${fileSize} bytes`);
      
      console.log(`\u2713 Generated ${data.length} items for ${entity.name} -> ${fileName} (${jsonData.length} bytes)`);
    } catch (error) {
      console.error(`Error generating ${entity.name}:`, error);
    }
  });
  
  console.log('\n\u2705 All mock data generation completed!');
}

// Run the generator
generateAllData();
