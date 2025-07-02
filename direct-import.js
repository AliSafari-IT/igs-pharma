/**
 * Direct database import script for generated entity data
 * This bypasses the CLI and directly uses the MySQL connection
 */

const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Read config
const configPath = path.join(__dirname, 'setup-data.yml');
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

// Database connection settings
const dbConfig = {
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.database,
  multipleStatements: true
};

// Get current directory
const dataDir = path.join(__dirname, 'generated-data');

// Import entities in dependency order (foundation tables first)
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

/**
 * Format a value for SQL
 */
function formatValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  return value;
}

/**
 * Import a single entity
 */
async function importEntity(connection, entity) {
  console.log(`\nImporting ${entity.name}...`);
  
  try {
    // Read the entity data
    const data = JSON.parse(fs.readFileSync(entity.file, 'utf8'));
    console.log(`- Found ${data.length} records`);
    
    // Prepare batch insert
    if (data.length === 0) {
      console.log('- No data to import');
      return;
    }

    // Check if table exists and get columns
    const [tableInfo] = await connection.query(`SHOW COLUMNS FROM ${entity.name}`);
    const tableColumns = tableInfo.map(col => col.Field);
    console.log(`- Table has ${tableColumns.length} columns`);
    
    // Start transaction
    await connection.query('START TRANSACTION');
    console.log('- Transaction started');
    
    // Process records in batches
    const batchSize = 20;
    let successCount = 0;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const values = [];
      
      for (const item of batch) {
        // Filter to only include columns that exist in the table
        const validColumns = Object.keys(item).filter(key => 
          tableColumns.includes(key) && item[key] !== undefined);
        
        // Format values for SQL
        const formattedValues = validColumns.map(key => formatValue(item[key]));
        
        // Add to values list
        values.push(`(${formattedValues.join(', ')})`);
      }
      
      if (values.length > 0) {
        const columns = Object.keys(batch[0])
          .filter(key => tableColumns.includes(key) && batch[0][key] !== undefined);
        
        const insertQuery = `
          INSERT INTO ${entity.name} (${columns.join(', ')})
          VALUES ${values.join(',\n')}
        `;
        
        try {
          await connection.query(insertQuery);
          successCount += values.length;
          process.stdout.write('.');
        } catch (err) {
          console.error(`\n- Error inserting batch: ${err.message}`);
          console.error(`- SQL: ${insertQuery.substring(0, 200)}...`);
          throw err;
        }
      }
    }
    
    // Commit transaction
    await connection.query('COMMIT');
    console.log(`\n- Successfully imported ${successCount} records`);
    return true;
  } catch (error) {
    // Rollback on error
    try {
      await connection.query('ROLLBACK');
      console.error(`- Transaction rolled back: ${error.message}`);
    } catch (rollbackError) {
      console.error(`- Error rolling back transaction: ${rollbackError.message}`);
    }
    
    throw error;
  }
}

/**
 * Main import function
 */
async function importAll() {
  console.log('Starting direct database import...');
  console.log(`Database: ${dbConfig.database} on ${dbConfig.host}`);
  
  let connection;
  
  try {
    // Connect to database
    connection = await mysql.createConnection(dbConfig);
    console.log('Connected to database');
    
    for (const entity of entitiesToImport) {
      try {
        await importEntity(connection, entity);
        console.log(`✅ ${entity.name} imported successfully`);
      } catch (error) {
        console.error(`❌ Failed to import ${entity.name}: ${error.message}`);
        
        // Ask to continue
        const answer = await promptToContinue();
        if (!answer) {
          console.log('Import process aborted');
          break;
        }
      }
    }
    
    console.log('\nImport process completed!');
  } catch (error) {
    console.error(`Database error: ${error.message}`);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

/**
 * Simple prompt function
 */
async function promptToContinue() {
  process.stdout.write('Continue with next entity? (y/n): ');
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const response = data.toString().trim().toLowerCase();
      resolve(response === 'y' || response === 'yes');
    });
  });
}

// Run the import
importAll();
