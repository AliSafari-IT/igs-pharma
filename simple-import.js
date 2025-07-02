/**
 * Simple direct database import script for C# entity data
 */

const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const readline = require('readline');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Read config
const configPath = path.join(__dirname, 'setup-data.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

// Database connection settings
const dbConfig = {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database
};

// Get current directory
const dataDir = path.join(__dirname, 'generated-data');

// Import entities in correct order
const entitiesToImport = [
  { name: 'Category', file: path.join(dataDir, 'category-generated.json') },
  { name: 'Doctor', file: path.join(dataDir, 'doctor-generated.json') },
  { name: 'Product', file: path.join(dataDir, 'product-generated.json') },
  { name: 'User', file: path.join(dataDir, 'user-generated.json') },
  { name: 'Patient', file: path.join(dataDir, 'patient-generated.json') },
  { name: 'Supplier', file: path.join(dataDir, 'supplier-generated.json') },
  { name: 'InventoryTransaction', file: path.join(dataDir, 'inventorytransaction-generated.json') },
  { name: 'Prescription', file: path.join(dataDir, 'prescription-generated.json') },
  { name: 'PrescriptionItem', file: path.join(dataDir, 'prescriptionitem-generated.json') },
  { name: 'PurchaseOrder', file: path.join(dataDir, 'purchaseorder-generated.json') },
  { name: 'Sale', file: path.join(dataDir, 'sale-generated.json') },
  { name: 'SaleItem', file: path.join(dataDir, 'saleitem-generated.json') },
  { name: 'Settings', file: path.join(dataDir, 'settings-generated.json') }
];

// Create database connection
const connection = mysql.createConnection(dbConfig);

// Connect to database
connection.connect((err) => {
  if (err) {
    console.error(`Error connecting to database: ${err.message}`);
    process.exit(1);
  }
  
  console.log(`Connected to database ${dbConfig.database} on ${dbConfig.host}`);
  importEntities(0);
});

// Process each entity
function importEntities(index) {
  if (index >= entitiesToImport.length) {
    console.log('\n✅ All entities imported successfully!');
    connection.end();
    rl.close();
    return;
  }
  
  const entity = entitiesToImport[index];
  console.log(`\nImporting ${entity.name}...`);
  
  // Read JSON data
  const jsonData = fs.readFileSync(entity.file, 'utf8');
  const data = JSON.parse(jsonData);
  
  console.log(`Found ${data.length} records to import`);
  
  if (data.length === 0) {
    console.log('No data to import, skipping');
    importEntities(index + 1);
    return;
  }
  
  // Get table structure
  connection.query(`SHOW COLUMNS FROM ${entity.name}`, (err, columns) => {
    if (err) {
      console.error(`Error getting table structure for ${entity.name}: ${err.message}`);
      promptContinue(() => importEntities(index + 1));
      return;
    }
    
    const tableColumns = columns.map(c => c.Field);
    console.log(`Table has ${tableColumns.length} columns`);
    
    // Process each record
    let successCount = 0;
    let processedCount = 0;
    
    function processRecord(recordIndex) {
      if (recordIndex >= data.length) {
        console.log(`\nSuccessfully imported ${successCount} of ${data.length} records`);
        importEntities(index + 1);
        return;
      }
      
      const record = data[recordIndex];
      
      // Prepare the insert data with only valid columns
      const insertData = {};
      Object.keys(record).forEach(key => {
        if (tableColumns.includes(key)) {
          insertData[key] = record[key];
        }
      });
      
      // Insert the record
      connection.query(`INSERT INTO ${entity.name} SET ?`, insertData, (err) => {
        processedCount++;
        
        if (err) {
          console.error(`Error inserting record ${recordIndex + 1}: ${err.message}`);
        } else {
          successCount++;
          if (processedCount % 5 === 0) {
            process.stdout.write('.');
          }
        }
        
        // Continue with next record
        processRecord(recordIndex + 1);
      });
    }
    
    // Start processing records
    processRecord(0);
  });
}

// Prompt user to continue on error
function promptContinue(callback) {
  rl.question('Continue with next entity? (y/n): ', (answer) => {
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      callback();
    } else {
      console.log('Import aborted');
      connection.end();
      rl.close();
      process.exit(0);
    }
  });
}
