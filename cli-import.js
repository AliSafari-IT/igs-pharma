/**
 * Improved CLI-based import script for the generated entity data
 * Uses the existing setup-data CLI which has database connectivity built-in
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Setup readline interface for user prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Important paths
const dataDir = path.resolve(__dirname, 'generated-data');
const configPath = path.resolve(__dirname, 'setup-data.yml');

// Ordered entity list (foundation tables first)
const entitiesToImport = [
  { name: 'Category', file: 'category-generated.json' },
  { name: 'Doctor', file: 'doctor-generated.json' },
  { name: 'Product', file: 'product-generated.json' },
  { name: 'User', file: 'user-generated.json' },
  { name: 'Patient', file: 'patient-generated.json' },
  { name: 'Supplier', file: 'supplier-generated.json' },
  { name: 'InventoryTransaction', file: 'inventorytransaction-generated.json' },
  { name: 'Prescription', file: 'prescription-generated.json' },
  { name: 'PrescriptionItem', file: 'prescriptionitem-generated.json' },
  { name: 'PurchaseOrder', file: 'purchaseorder-generated.json' },
  { name: 'Sale', file: 'sale-generated.json' },
  { name: 'SaleItem', file: 'saleitem-generated.json' },
  { name: 'Settings', file: 'settings-generated.json' }
];

// Verify files exist
console.log('Verifying generated data files...');
let missingFiles = false;

for (const entity of entitiesToImport) {
  const filePath = path.join(dataDir, entity.file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Missing data file: ${filePath}`);
    missingFiles = true;
  }
}

if (missingFiles) {
  console.error('Some data files are missing. Please generate them first.');
  process.exit(1);
}

// Verify config file
if (!fs.existsSync(configPath)) {
  console.error(`❌ Config file not found: ${configPath}`);
  process.exit(1);
}

/**
 * Execute a CLI command with proper output handling
 */
function executeCommand(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true
    });
    
    let output = '';
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject({ code, output });
      }
    });
    
    child.on('error', (err) => {
      reject({ error: err, output });
    });
  });
}

/**
 * Import a single entity
 */
async function importEntity(entity) {
  const filePath = path.join(dataDir, entity.file);
  console.log(`\n📦 Importing ${entity.name}...`);
  
  try {
    // Read file to get count
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Found ${data.length} records to import`);
    
    if (data.length === 0) {
      console.log('No data to import, skipping');
      return true;
    }
    
    // Build command with arguments
    const command = 'pnpm';
    const args = [
      'run',
      'setup-data',
      'import',
      '-f', filePath,
      '-t', entity.name,
      '-c', configPath
    ];
    
    await executeCommand(command, args);
    console.log(`✅ Successfully imported ${entity.name}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to import ${entity.name}:`);
    
    if (error.output) {
      console.error(error.output);
    } else {
      console.error(error);
    }
    
    return false;
  }
}

/**
 * Prompt user to continue after an error
 */
function promptContinue() {
  return new Promise((resolve) => {
    rl.question('Continue with next entity? (y/n): ', (answer) => {
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Main import process
 */
async function importAll() {
  console.log('🚀 Starting import process...');
  console.log(`Config file: ${configPath}`);
  console.log(`Data directory: ${dataDir}`);
  
  let successCount = 0;
  
  for (let i = 0; i < entitiesToImport.length; i++) {
    const entity = entitiesToImport[i];
    console.log(`\n[${i + 1}/${entitiesToImport.length}] Processing ${entity.name}`);
    
    const success = await importEntity(entity);
    
    if (success) {
      successCount++;
    } else {
      const shouldContinue = await promptContinue();
      
      if (!shouldContinue) {
        console.log('\n⛔ Import process aborted by user');
        break;
      }
    }
  }
  
  console.log(`\n🎉 Import complete! Successfully imported ${successCount} of ${entitiesToImport.length} entities`);
  rl.close();
}

// Start the import process
importAll();
