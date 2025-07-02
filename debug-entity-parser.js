/**
 * Debug script to test the C# entity parser directly
 */

const fs = require('fs');
const path = require('path');
const { parseEntityDirectory, buildDependencyGraph, topologicalSort } = require('./packages/setup-data/src/csharp-parser');

// Define source directory
const SCHEMAS_DIR = path.join(__dirname, 'backend', 'src', 'IGS.Domain', 'Entities');

console.log(`Testing C# entity parser on directory: ${SCHEMAS_DIR}`);

try {
  // List C# files in the directory
  const files = fs.readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.cs'));
  console.log(`Found ${files.length} C# files: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
  
  // Parse a single file first to test
  if (files.length > 0) {
    const testFile = path.join(SCHEMAS_DIR, files[0]);
    console.log(`\nTesting parser on single file: ${files[0]}`);
    
    const parser = require('./packages/setup-data/src/csharp-parser');
    try {
      const entityInfo = parser.parseEntityFile(testFile);
      console.log('✓ Successfully parsed single file');
      console.log(`Entity name: ${entityInfo.name}`);
      console.log(`Properties: ${entityInfo.properties.length}`);
      
      // Display first few properties
      entityInfo.properties.slice(0, 3).forEach(prop => {
        console.log(`- ${prop.name} (${prop.type})`);
      });
    } catch (err) {
      console.error(`✗ Error parsing file: ${err.message}`);
      console.error(err.stack);
    }
  }
  
  // Try parsing all files
  console.log('\nParsing all entity files...');
  const entities = parseEntityDirectory(SCHEMAS_DIR);
  console.log(`✓ Successfully parsed ${Object.keys(entities).length} entities`);
  
  // Build dependency graph
  console.log('\nBuilding dependency graph...');
  const graph = buildDependencyGraph(entities);
  console.log('✓ Successfully built dependency graph');
  
  // Sort entities by dependency
  console.log('\nSorting entities by dependency...');
  const sortedEntities = topologicalSort(graph);
  console.log('✓ Successfully sorted entities');
  console.log(`Sorted order: ${sortedEntities.join(', ')}`);
  
} catch (error) {
  console.error(`Error: ${error.message}`);
  console.error(error.stack);
}
