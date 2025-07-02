/**
 * Direct import script for IGS Pharma mock data
 * This script directly imports the generated mock data to the database
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const yaml = require('js-yaml');

// Load configuration
const configPath = path.join(__dirname, '..', 'setup-data.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

// Database connection details
const dbConfig = {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database
};

// Field mappings for database tables
const fieldMappings = {
  // Define fields to exclude or rename for each table
  Users: {
    exclude: ['Password'], // Password field doesn't exist in DB schema
    rename: {}
  },
  Categories: {
    exclude: [],
    rename: {}
  },
  Products: {
    exclude: [],
    rename: {}
  },
  Suppliers: {
    exclude: [],
    rename: {}
  },
  Doctors: {
    exclude: [],
    rename: {}
  },
  Patients: {
    exclude: [],
    rename: {}
  }
};

// Special field handling
function processSpecialFields(tableName, item) {
  const processedItem = { ...item };
  
  // Handle special fields for each table
  switch (tableName) {
    case 'Users':
      // Serialize Permissions field as JSON string
      if (Array.isArray(processedItem.Permissions)) {
        processedItem.Permissions = JSON.stringify(processedItem.Permissions);
      } else if (typeof processedItem.Permissions === 'string' && !processedItem.Permissions.startsWith('[')) {
        // If it's a string but not a JSON array, wrap it
        processedItem.Permissions = `["${processedItem.Permissions}"]`;
      }
      break;
      
    case 'Products':
      // Ensure numeric fields are numbers
      if (processedItem.Price) processedItem.Price = Number(processedItem.Price);
      if (processedItem.CostPrice) processedItem.CostPrice = Number(processedItem.CostPrice);
      if (processedItem.StockQuantity) processedItem.StockQuantity = Number(processedItem.StockQuantity);
      break;
      
    // Add other special cases as needed
  }
  
  return processedItem;
}

// Import data function
async function importData(tableName, filePath) {
  console.log(`\nImporting ${tableName} from ${filePath}...`);
  
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`File ${filePath} does not exist. Skipping.`);
      return 0;
    }
    
    // Read data from file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent || fileContent.trim() === '[]' || fileContent.trim() === '') {
      console.log(`Empty data in ${filePath}. Skipping.`);
      return 0;
    }
    
    const data = JSON.parse(fileContent);
    
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`No data found in ${filePath}. Skipping.`);
      return 0;
    }
    
    console.log(`Found ${data.length} items to import.`);
    
    // Connect to database
    const connection = await mysql.createConnection(dbConfig);
    console.log(`Connected to database ${dbConfig.database} on ${dbConfig.host}`);
    
    // Start transaction
    await connection.beginTransaction();
    console.log('Transaction started');
    
    let successCount = 0;
    
    // Process each item
    for (const originalItem of data) {
      try {
        // Process special fields
        const item = processSpecialFields(tableName, originalItem);
        
        // Apply field mappings
        const mapping = fieldMappings[tableName] || { exclude: [], rename: {} };
        
        // Extract fields and values, excluding any fields in the exclude list
        const fields = Object.keys(item)
          .filter(key => item[key] !== null)
          .filter(key => !mapping.exclude.includes(key));
        
        // Map values, applying any renames
        const values = fields.map(field => item[field]);
        
        // Generate placeholders for SQL query
        const placeholders = fields.map(() => '?').join(', ');
        
        // Build query with ON DUPLICATE KEY UPDATE
        const updateClause = fields
          .map(field => `${field} = VALUES(${field})`)
          .join(', ');
        
        const query = `INSERT INTO ${tableName} (${fields.join(', ')}) 
                      VALUES (${placeholders}) 
                      ON DUPLICATE KEY UPDATE ${updateClause}`;
        
        // Execute query
        const [result] = await connection.execute(query, values);
        successCount++;
        
        if (successCount % 5 === 0 || successCount === data.length) {
          console.log(`  ✓ Imported ${successCount}/${data.length} items`);
        }
      } catch (err) {
        console.error(`  ✗ Error importing item: ${err.message}`);
        // Log the problematic item for debugging
        console.error(`  Item: ${JSON.stringify(originalItem).substring(0, 200)}...`);
      }
    }
    
    // Commit transaction
    await connection.commit();
    console.log('Transaction committed successfully');
    console.log(`✅ Successfully imported ${successCount} of ${data.length} items to ${tableName}`);
    
    // Close connection
    await connection.end();
    
    return successCount;
  } catch (error) {
    console.error(`❌ Import failed: ${error.message}`);
    return 0;
  }
}

// Main function
async function main() {
  console.log('Starting direct import process...');
  console.log(`Using config from ${configPath}`);
  
  // Define the order of tables to import (respecting foreign key constraints)
  const importOrder = [
    { table: 'Categories', file: 'category-generated.json' },
    { table: 'Users', file: 'user-generated.json' },
    { table: 'Suppliers', file: 'supplier-generated.json' },
    { table: 'Doctors', file: 'doctor-generated.json' },
    { table: 'Products', file: 'product-generated.json' },
    { table: 'Patients', file: 'patient-generated.json' },
    { table: 'Prescriptions', file: 'prescription-generated.json' },
    { table: 'PrescriptionItems', file: 'prescriptionitem-generated.json' }
  ];
  
  // Import data in order
  let totalImported = 0;
  for (const item of importOrder) {
    const count = await importData(item.table, path.join(__dirname, item.file));
    totalImported += count || 0;
  }
  
  console.log(`\n✅ Direct import process completed! Total imported: ${totalImported} items`);
}

// Run the script
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
