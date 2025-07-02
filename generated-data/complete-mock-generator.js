/**
 * Complete mock data generator for IGS Pharma
 * This script generates mock data for all entities and saves them to JSON files
 */

const fs = require('fs');
const path = require('path');

// Helper functions for generating random data
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDecimal(min, max, decimals = 2) {
  const value = Math.random() * (max - min) + min;
  return Number(value.toFixed(decimals));
}

function randomBoolean() {
  return Math.random() > 0.5;
}

function randomDate() {
  const start = new Date(2024, 0, 1).getTime();
  const end = new Date(2025, 6, 2).getTime();
  const date = new Date(start + Math.random() * (end - start));
  return date.toISOString().slice(0, 10) + ' ' + 
    date.toTimeString().slice(0, 8);
}

function randomEmail() {
  return `${randomString(8)}@example.com`;
}

function randomName() {
  const names = ['John', 'Jane', 'Bob', 'Alice', 'David', 'Sarah', 'Michael', 'Emma', 
                'William', 'Olivia', 'James', 'Sophia', 'Robert', 'Ava', 'Joseph', 'Mia'];
  return names[Math.floor(Math.random() * names.length)];
}

function randomSurname() {
  const surnames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 
                   'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 
                   'Wilson', 'Anderson', 'Thomas'];
  return surnames[Math.floor(Math.random() * surnames.length)];
}

// Generate Categories (20 items)
function generateCategories() {
  console.log('Generating categories...');
  const categories = [];
  for (let i = 0; i < 20; i++) {
    categories.push({
      Id: null,
      Name: `Category ${i+1}`,
      Description: `Description for category ${i+1}`,
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return categories;
}

// Generate Users (20 items)
function generateUsers() {
  console.log('Generating users...');
  const users = [];
  const roles = [0, 1, 2, 3, 4]; // 0=Admin, 1=Manager, 2=Pharmacist, 3=Technician, 4=Cashier
  
  for (let i = 0; i < 20; i++) {
    const firstName = randomName();
    const lastName = randomSurname();
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
    const username = `${firstName.toLowerCase()}${i}`;
    const role = roles[i % roles.length];
    const permissions = [];
    
    // Define permission sets by resource
    const permissionSets = {
      products: ['view', 'read', 'write'],
      categories: ['view', 'read', 'write'],
      suppliers: ['view', 'read', 'write'],
      inventory: ['view', 'read', 'write'],
      sales: ['view', 'read', 'write'],
      patients: ['view', 'read', 'write'],
      doctors: ['view', 'read', 'write'],
      prescriptions: ['view', 'read', 'write'],
      purchaseorders: ['view', 'read', 'write'],
      settings: ['view', 'read', 'write'],
      users: ['view', 'read', 'write']
    };
    
    // Define which resources each role has access to
    const roleResources = {
      0: Object.keys(permissionSets), // Admin: all resources
      1: ['products', 'categories', 'suppliers', 'inventory', 'sales', 'patients', 'doctors', 'prescriptions'], // Manager
      2: ['products', 'categories', 'suppliers', 'inventory'], // Inventory Manager
      3: ['products', 'categories', 'suppliers'], // Product Manager
      4: ['products'] // Basic User
    };
    
    // Generate permissions based on role
    const resources = roleResources[role] || [];
    resources.forEach(resource => {
      const actions = permissionSets[resource] || [];
      actions.forEach(action => {
        permissions.push(`${resource}.${action}`);
      });
    })
    
    users.push({
      Id: null,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Username: username,
      PasswordHash: '$2a$11$.fjUmSt/kUSif8XQmlEHROPT3ruwR4k3rAMLa4o0hehcgsB21J5VK', // Hashed version of 'Password123!'
      Role: role,
      Permissions: permissions,
      IsActive: true,
      LastLoginAt: randomDate(),
      CreatedAt: randomDate(),
      UpdatedAt: randomDate(),
      LicenseNumber: '',
      Phone: `+1${randomInt(1000000000, 9999999999)}`,
      Department: '',
      EmployeeId: `EMP${randomInt(1000, 9999)}`,
      CardId: `CARD${randomInt(1000, 9999)}`,
      CardExpiryDate: randomDate()
    });
  }
  return users;
}

// Generate Products (20 items)
function generateProducts() {
  console.log('Generating products...');
  const products = [];
  
  // Use actual CategoryId values from the database
  const categoryIds = [287, 277, 275, 290, 279, 278, 272, 282];
  // Use actual SupplierId values from the database
  const supplierIds = [10, 19, 6, 20, 12, 5, 11, 7, 16, 17];
  
  for (let i = 0; i < 20; i++) {
    const price = randomDecimal(10, 100);
    products.push({
      Id: null,
      Name: `Product ${i+1}`,
      Description: `Description for product ${i+1}`,
      SKU: `SKU-${randomInt(10000, 99999)}`,
      Barcode: `BAR-${randomInt(100000, 999999)}`,
      Price: price,
      CostPrice: price * 0.6,
      CategoryId: categoryIds[i % categoryIds.length], // Use actual CategoryId values
      SupplierId: supplierIds[i % supplierIds.length], // Use actual SupplierId values
      StockQuantity: randomInt(10, 100),
      MinStockLevel: 10,
      MaxStockLevel: 1000,
      ExpiryDate: randomDate(),
      ManufactureDate: randomDate(),
      Manufacturer: `Manufacturer ${i+1}`,
      BatchNumber: `BATCH-${randomInt(1000, 9999)}`,
      RequiresPrescription: randomBoolean(),
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return products;
}

// Generate Suppliers (20 items)
function generateSuppliers() {
  console.log('Generating suppliers...');
  const suppliers = [];
  for (let i = 0; i < 20; i++) {
    suppliers.push({
      Id: null,
      Name: `Supplier ${i+1}`,
      ContactName: `${randomName()} ${randomSurname()}`,
      Email: randomEmail(),
      Phone: `+1${randomInt(1000000000, 9999999999)}`,
      Address: `${randomInt(1, 999)} Main St, City ${i+1}`,
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return suppliers;
}

// Generate Doctors (20 items)
function generateDoctors() {
  console.log('Generating doctors...');
  const doctors = [];
  for (let i = 0; i < 20; i++) {
    const firstName = randomName();
    const lastName = randomSurname();
    doctors.push({
      Id: null,
      FirstName: firstName,
      LastName: lastName,
      Email: `dr.${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      Phone: `+1${randomInt(1000000000, 9999999999)}`,
      Specialty: `Specialty ${i % 5 + 1}`,
      LicenseNumber: `LIC-${randomInt(10000, 99999)}`,
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return doctors;
}

// Generate Patients (20 items)
function generatePatients() {
  console.log('Generating patients...');
  const patients = [];
  for (let i = 0; i < 20; i++) {
    const firstName = randomName();
    const lastName = randomSurname();
    patients.push({
      Id: null,
      FirstName: firstName,
      LastName: lastName,
      Email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      Phone: `+1${randomInt(1000000000, 9999999999)}`,
      Address: `${randomInt(1, 999)} Main St`,
      City: `City ${i+1}`,
      PostalCode: `${randomInt(10000, 99999)}`,
      Country: `Country ${i % 5 + 1}`,
      DateOfBirth: randomDate(),
      Gender: i % 2 === 0 ? 'Male' : 'Female',
      InsuranceProvider: `Insurance ${i % 5 + 1}`,
      InsuranceNumber: `INS-${randomInt(10000, 99999)}`,
      Allergies: `Allergies for patient ${i+1}`,
      MedicalConditions: `Medical conditions for patient ${i+1}`,
      DoctorId: 79 + (i % 20), // Use actual DoctorId values from the database (79-98)
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return patients;
}

// Generate Prescriptions (20 items)
function generatePrescriptions() {
  console.log('Generating prescriptions...');
  const prescriptions = [];
  
  // Use actual PatientId values - we'll assume they start from the last import
  const patientStartId = 40; // Assuming patients start from ID 40
  
  for (let i = 0; i < 20; i++) {
    const doctorName = `Dr. ${randomName()} ${randomSurname()}`;
    
    prescriptions.push({
      Id: null,
      PrescriptionNumber: `RX-${randomInt(100000, 999999)}`,
      PrescriptionDate: randomDate(),
      DoctorName: doctorName,
      DoctorLicense: `LIC-${randomInt(10000, 99999)}`,
      DoctorPhone: `+1${randomInt(1000000000, 9999999999)}`,
      Instructions: `Take as directed by your doctor`,
      Status: i % 3, // 0=Active, 1=Completed, 2=Cancelled
      FilledDate: randomDate(),
      RefillsRemaining: randomInt(0, 3),
      TotalRefills: randomInt(3, 6),
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate(),
      PatientId: patientStartId + i
    });
  }
  return prescriptions;
}

// Generate PrescriptionItems (60 items, 3 per prescription)
function generatePrescriptionItems() {
  console.log('Generating prescription items...');
  const prescriptionItems = [];
  
  // Use actual ProductId values from the database (350-369)
  const productIds = [350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 364, 365, 366, 367, 368, 369];
  const prescriptionStartId = 6; // Based on actual prescription IDs in the database
  
  for (let i = 0; i < 20; i++) { // For each prescription
    for (let j = 0; j < 3; j++) { // 3 items per prescription
      prescriptionItems.push({
        Id: null,
        PrescriptionId: prescriptionStartId + i,
        ProductId: productIds[(i * 3 + j) % productIds.length], // Cycle through actual product IDs
        Quantity: randomInt(1, 5),
        Dosage: `${randomInt(1, 3)} tablet(s) ${randomInt(1, 3)} time(s) daily`,
        Instructions: `Take with ${j % 2 === 0 ? 'food' : 'water'}`,
        DaysSupply: randomInt(7, 30),
        IsGenericAllowed: randomBoolean(),
        CreatedAt: randomDate()
        // No UpdatedAt field in the schema
      });
    }
  }
  return prescriptionItems;
}

// Main function to generate all mock data
async function generateAllMockData() {
  console.log('Starting complete mock data generation...\n');
  
  // Generate Categories
  console.log('--- Generating Categories ---');
  const categories = generateCategories();
  await writeJsonToFile('category-generated.json', categories);
  console.log(`✓ Generated ${categories.length} items for Categories -> category-generated.json\n`);
  
  // Generate Users
  console.log('--- Generating Users ---');
  const users = generateUsers();
  await writeJsonToFile('user-generated.json', users);
  console.log(`✓ Generated ${users.length} items for Users -> user-generated.json\n`);
  
  // Generate Products
  console.log('--- Generating Products ---');
  const products = generateProducts();
  await writeJsonToFile('product-generated.json', products);
  console.log(`✓ Generated ${products.length} items for Products -> product-generated.json\n`);
  
  // Generate Suppliers
  console.log('--- Generating Suppliers ---');
  const suppliers = generateSuppliers();
  await writeJsonToFile('supplier-generated.json', suppliers);
  console.log(`✓ Generated ${suppliers.length} items for Suppliers -> supplier-generated.json\n`);
  
  // Generate Doctors
  console.log('--- Generating Doctors ---');
  const doctors = generateDoctors();
  await writeJsonToFile('doctor-generated.json', doctors);
  console.log(`✓ Generated ${doctors.length} items for Doctors -> doctor-generated.json\n`);
  
  // Generate Patients
  console.log('--- Generating Patients ---');
  const patients = generatePatients();
  await writeJsonToFile('patient-generated.json', patients);
  console.log(`✓ Generated ${patients.length} items for Patients -> patient-generated.json\n`);
  
  // Generate Prescriptions
  console.log('--- Generating Prescriptions ---');
  const prescriptions = generatePrescriptions();
  await writeJsonToFile('prescription-generated.json', prescriptions);
  console.log(`✓ Generated ${prescriptions.length} items for Prescriptions -> prescription-generated.json\n`);
  
  // Generate PrescriptionItems
  console.log('--- Generating PrescriptionItems ---');
  const prescriptionItems = generatePrescriptionItems();
  await writeJsonToFile('prescriptionitem-generated.json', prescriptionItems);
  console.log(`✓ Generated ${prescriptionItems.length} items for PrescriptionItems -> prescriptionitem-generated.json\n`);
  
  console.log('✅ Complete mock data generation completed!');
}

// Helper function to write JSON to file
async function writeJsonToFile(filename, data) {
  const filePath = path.join(__dirname, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  
  // Verify file was written correctly
  const fileExists = fs.existsSync(filePath);
  const fileSize = fileExists ? fs.statSync(filePath).size : 0;
  return { fileExists, fileSize };
}

// Run the generator
generateAllMockData();
