/**
 * Script to demonstrate using setup-data's C# entity generation feature
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Define source and output directories
const SCHEMAS_DIR = path.join(__dirname, 'backend', 'src', 'IGS.Domain', 'Entities');
const OUTPUT_DIR = path.join(__dirname, 'generated-data');

// Check if the schemas directory exists
if (!fs.existsSync(SCHEMAS_DIR)) {
  console.error(`Error: Schemas directory not found: ${SCHEMAS_DIR}`);
  console.log('Available directories in backend/src:');
  const backendSrcPath = path.join(__dirname, 'backend', 'src');
  if (fs.existsSync(backendSrcPath)) {
    fs.readdirSync(backendSrcPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .forEach(dirent => console.log(`- ${dirent.name}`));
  } else {
    console.log('backend/src directory not found');
  }
  process.exit(1);
}

// Create output directory if it doesn't exist
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Created output directory: ${OUTPUT_DIR}`);
}

console.log(`Schemas directory: ${SCHEMAS_DIR}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log('Generating mock data for all entities...');

// List C# files in the schemas directory for verification
const entityFiles = fs.readdirSync(SCHEMAS_DIR)
  .filter(file => file.endsWith('.cs'))
  .map(file => path.join(SCHEMAS_DIR, file));

if (entityFiles.length === 0) {
  console.error(`No C# files found in: ${SCHEMAS_DIR}`);
  process.exit(1);
}

console.log(`Found ${entityFiles.length} C# entity files:`);
entityFiles.slice(0, 5).forEach(file => console.log(`- ${path.basename(file)}`));
if (entityFiles.length > 5) {
  console.log(`...and ${entityFiles.length - 5} more`);
}

try {
  // Use the new generate-from-csharp command with verbose output
  console.log('\nExecuting setup-data command...');
  
  const command = `pnpm run setup-data generate-from-csharp -d "${SCHEMAS_DIR}" -o "${OUTPUT_DIR}" -n 20 -s 12345`;
  console.log(`Command: ${command}`);
  
  const result = execSync(command, { encoding: 'utf8' });
  console.log('\nCommand output:');
  console.log(result);
  
  // Check if files were generated
  if (fs.existsSync(OUTPUT_DIR)) {
    const generatedFiles = fs.readdirSync(OUTPUT_DIR);
    console.log(`\nGenerated ${generatedFiles.length} files in ${OUTPUT_DIR}:`);
    generatedFiles.forEach(file => console.log(`- ${file}`));
    
    if (generatedFiles.includes('import-all.js')) {
      console.log('\nTo import all generated entities in the correct order:');
      console.log(`node ${OUTPUT_DIR}/import-all.js`);
    }
  } else {
    console.error(`Output directory ${OUTPUT_DIR} was not created.`);
  }
} catch (error) {
  console.error('Error executing setup-data command:');
  console.error(`${error.message}`);
  console.error('\nFor more details, try running the command directly:');
  console.error(`pnpm run setup-data generate-from-csharp -d "${SCHEMAS_DIR}" -o "${OUTPUT_DIR}" -n 20 -s 12345`);
}
