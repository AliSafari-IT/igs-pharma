/**
 * Auto-generated script to import all entities in the correct order
 * Run with: node import-all.js
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const readline = require('readline');
const util = require('util');
const mysql = require('mysql2/promise');
const yaml = require('js-yaml');
const { validateAllData } = require('./validate-data');

const execPromise = util.promisify(exec);

// Get current directory
const currentDir = __dirname;

// Command line arguments
const args = process.argv.slice(2);
const clearData = args.includes('--clear') || args.includes('-c');
const skipDuplicates = args.includes('--skip-duplicates') || args.includes('-s');
const updateDuplicates = args.includes('--update-duplicates') || args.includes('-u');

// Print help if requested
if (args.includes('--help') || args.includes('-h')) {
  console.log('Import All - Import all generated data to the database');
  console.log('\nUsage: node import-all.js [options]\n');
  console.log('Options:');
  console.log('  -c, --clear              Clear existing data before importing');
  console.log('  -s, --skip-duplicates    Skip duplicate entries instead of failing');
  console.log('  -u, --update-duplicates  Update existing records when duplicates are found');
  console.log('  -h, --help               Show this help message');
  process.exit(0);
}

// Import entities in dependency order (reversed so that independent entities come first)
const entitiesToImport = [
  { name: 'Categories', file: path.join(currentDir, 'category-generated.json') },
  { name: 'Doctors', file: path.join(currentDir, 'doctor-generated.json') },
  { name: 'Products', file: path.join(currentDir, 'product-generated.json') },
  { name: 'Users', file: path.join(currentDir, 'user-generated.json') },
  { name: 'InventoryTransactions', file: path.join(currentDir, 'inventorytransaction-generated.json') },
  { name: 'Patients', file: path.join(currentDir, 'patient-generated.json') },
  { name: 'Prescriptions', file: path.join(currentDir, 'prescription-generated.json') },
  { name: 'PrescriptionItems', file: path.join(currentDir, 'prescriptionitem-generated.json') },
  { name: 'Suppliers', file: path.join(currentDir, 'supplier-generated.json') },
  { name: 'PurchaseOrders', file: path.join(currentDir, 'purchaseorder-generated.json') },
  { name: 'Sales', file: path.join(currentDir, 'sale-generated.json') },
  { name: 'SaleItems', file: path.join(currentDir, 'saleitem-generated.json') },
  { name: 'Settings', file: path.join(currentDir, 'settings-generated.json') }
];

// Verify that config file exists
const configPath = path.join(process.cwd(), '../setup-data.yml');
if (!fs.existsSync(configPath)) {
  console.error(`Config file not found at ${configPath}. Please make sure setup-data.yml exists in the project root.`);
  process.exit(1);
}

// Make sure all files exist
for (const entity of entitiesToImport) {
  if (!fs.existsSync(entity.file)) {
    console.error(`File not found: ${entity.file}`);
    process.exit(1);
  }
}

// Function to clear data from a table
async function clearTable(tableName) {
  try {
    const mysql = require('mysql2/promise');
    const yaml = require('js-yaml');
    
    // Read config
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    
    // Create connection
    const connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });
    
    console.log(`Clearing data from ${tableName}...`);
    await connection.execute(`DELETE FROM ${tableName}`);
    console.log(`✅ Table ${tableName} cleared successfully`);
    
    await connection.end();
    return true;
  } catch (error) {
    console.error(`❌ Error clearing table ${tableName}:`, error.message);
    return false;
  }
}

async function importAll() {
  console.log('Starting import process...');
  console.log('Make sure your MySQL database is running and properly configured in setup-data.yml');
  console.log('Using config file:', configPath);
  
  // Validate all data files against database constraints
  console.log('\n🔍 Validating data files against database constraints...');
  try {
    validateAllData();
    console.log('✅ All data files validated successfully');
  } catch (error) {
    console.error('❌ Error validating data files:', error.message);
    const shouldContinue = await promptToContinue();
    if (!shouldContinue) return;
  }
  
  // Clear data if requested
  if (clearData) {
    console.log('\n🧹 Clearing existing data before import...');
    
    // Clear tables in reverse order to avoid foreign key constraints
    const tablesToClear = [...entitiesToImport].reverse();
    
    for (const entity of tablesToClear) {
      await clearTable(entity.name);
    }
    
    console.log('✅ All tables cleared successfully');
  }
  
  console.log('-'.repeat(50));
  
  // Process each entity
  for (const entity of entitiesToImport) {
    console.log(`Importing ${entity.name}...`);
    try {
      // Build the import command with options
      let command = `pnpm run setup-data import -f "${entity.file}" -t ${entity.name} -c "${configPath}"`;
      
      // Add duplicate handling options
      if (skipDuplicates) {
        command += " --skip-duplicates";
      }
      if (updateDuplicates) {
        command += " --update-duplicates";
      }
      
      console.log(`Running: ${command}`);
      
      const { stdout, stderr } = await execPromise(command);
      console.log(stdout);
      
      if (stderr) {
        console.warn(`Warnings for ${entity.name}:`, stderr);
      }
      
      console.log(`✅ Successfully imported ${entity.name}`);
      console.log('-'.repeat(50));
    } catch (error) {
      console.error(`❌ Error importing ${entity.name}:`);
      if (error.stdout) console.error('Output:', error.stdout);
      if (error.stderr) console.error('Error details:', error.stderr);
      console.error(`Command failed with exit code ${error.code}`);
      console.error('-'.repeat(50));
      
      const continuePrompt = await promptToContinue();
      if (!continuePrompt) {
        process.exit(1);
      }
    }
  }
  
  console.log('\n🎉 All entities imported successfully!');
}

// Simple prompt function to ask if user wants to continue after an error
async function promptToContinue() {
  process.stdout.write('Continue with next entity? (y/n): ');
  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const response = data.toString().trim().toLowerCase();
      resolve(response === 'y' || response === 'yes');
    });
  });
}

importAll();
