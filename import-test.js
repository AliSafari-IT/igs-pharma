/**
 * Test script to import a single entity with verbose output
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Test with Category entity (should be the simplest)
const entityFile = path.join(__dirname, 'generated-data', 'category-generated.json');
const configPath = path.join(__dirname, 'setup-data.yml');

console.log('Starting test import...');
console.log(`Entity file: ${entityFile}`);
console.log(`Config file: ${configPath}`);

// Verify files exist
if (!fs.existsSync(entityFile)) {
  console.error(`Entity file not found: ${entityFile}`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  process.exit(1);
}

try {
  // Execute the import with stdio: 'inherit' to see real-time output
  console.log('\nRunning import command:');
  const command = `pnpm run setup-data import -f "${entityFile}" -t Category -c "${configPath}" --verbose`;
  console.log(`> ${command}`);
  
  execSync(command, { 
    stdio: 'inherit',  // This shows real-time output in the console
    encoding: 'utf-8'
  });
  
  console.log('\nImport completed successfully!');
} catch (error) {
  console.error('\nImport failed with error:');
  console.error(error.message);
  process.exit(1);
}
