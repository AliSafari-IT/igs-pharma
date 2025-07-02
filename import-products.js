#!/usr/bin/env node

/**
 * Product Import Script
 * 
 * This script imports products from a JSON file to the API with proper PascalCase property names
 * 
 * Usage:
 *   node import-products.js [options]
 * 
 * Options:
 *   --index <number>     Import only the product at the specified index
 *   --category <number>  Override all CategoryId values with the specified ID
 *   --file <filename>    Use the specified JSON file (default: products.json)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:5000/api/Products';
let jsonFile = 'products.json';
let index = -1;
let overrideCategory = false;
let categoryId = 1;

// Parse command line arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--index':
      index = parseInt(args[++i], 10);
      break;
    case '--category':
      overrideCategory = true;
      categoryId = parseInt(args[++i], 10);
      break;
    case '--file':
      jsonFile = args[++i];
      break;
    case '--help':
      console.log(`
Usage: node import-products.js [options]

Options:
  --index <number>     Import only the product at the specified index
  --category <number>  Override all CategoryId values with the specified ID
  --file <filename>    Use the specified JSON file (default: products.json)
  --help               Show this help message
      `);
      process.exit(0);
      break;
  }
}

// Function to convert camelCase properties to PascalCase
function convertToPascalCase(product) {
  const pascalCaseProduct = {};
  
  // Map of camelCase to PascalCase property names
  const propertyMap = {
    'name': 'Name',
    'description': 'Description',
    'sku': 'SKU',
    'barcode': 'Barcode',
    'price': 'Price',
    'costPrice': 'CostPrice',
    'stockQuantity': 'StockQuantity',
    'minStockLevel': 'MinStockLevel',
    'maxStockLevel': 'MaxStockLevel',
    'expiryDate': 'ExpiryDate',
    'manufactureDate': 'ManufactureDate',
    'manufacturer': 'Manufacturer',
    'batchNumber': 'BatchNumber',
    'requiresPrescription': 'RequiresPrescription',
    'categoryId': 'CategoryId',
    'supplierId': 'SupplierId'
  };
  
  // Convert each property to PascalCase
  for (const [camelCase, pascalCase] of Object.entries(propertyMap)) {
    if (product[camelCase] !== undefined) {
      pascalCaseProduct[pascalCase] = product[camelCase];
    }
  }
  
  // Override category ID if specified
  if (overrideCategory) {
    console.log(`Overriding CategoryId from ${pascalCaseProduct.CategoryId} to ${categoryId}`);
    pascalCaseProduct.CategoryId = categoryId;
  }
  
  return pascalCaseProduct;
}

// Function to import a single product
async function importProduct(product, idx) {
  console.log(`\nAdding product [${idx}] ${product.name || ''}...`);
  
  // Convert to PascalCase
  const pascalCaseProduct = convertToPascalCase(product);
  
  console.log('Sending JSON:');
  console.log(JSON.stringify(pascalCaseProduct, null, 2));
  
  try {
    // Send request with axios
    const response = await axios.post(API_URL, pascalCaseProduct, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`\n✅ Success! Product added with ID: ${response.data.id}`);
    return true;
  } catch (error) {
    console.log('\n❌ Failed to add product.');
    
    if (error.response) {
      console.log(`Status code: ${error.response.status}`);
      console.log('Error details:', error.response.data);
    } else {
      console.log(`Error: ${error.message}`);
    }
    
    return false;
  }
}

// Main function
async function main() {
  // Display script info
  console.log('Import Products Script');
  console.log('======================');
  console.log(`API URL: ${API_URL}`);
  console.log(`JSON File: ${jsonFile}`);
  
  if (index >= 0) {
    console.log(`Importing single product at index: ${index}`);
  } else {
    console.log('Importing all products');
  }
  
  if (overrideCategory) {
    console.log(`Overriding all CategoryId values to: ${categoryId}`);
  } else {
    console.log('Using original CategoryId values from JSON');
  }
  console.log('======================');
  
  // Read and process the JSON file
  console.log(`Reading products from ${jsonFile}...`);
  
  try {
    const data = fs.readFileSync(path.resolve(jsonFile), 'utf8');
    const products = JSON.parse(data);
    
    console.log(`Found ${products.length} products`);
    
    let successCount = 0;
    let failedCount = 0;
    
    // Process products based on index parameter
    if (index >= 0) {
      if (index < products.length) {
        console.log(`Processing single product at index ${index}`);
        const success = await importProduct(products[index], index);
        if (success) successCount++;
        else failedCount++;
      } else {
        console.log(`Error: Index ${index} is out of range (0-${products.length - 1})`);
        process.exit(1);
      }
    } else {
      console.log(`Processing all ${products.length} products...`);
      for (let i = 0; i < products.length; i++) {
        const success = await importProduct(products[i], i);
        if (success) successCount++;
        else failedCount++;
      }
    }
    
    // Display summary
    console.log('\n--- Import Summary ---');
    console.log(`Total products processed: ${successCount + failedCount}`);
    console.log(`Successfully added: ${successCount}`);
    console.log(`Failed: ${failedCount}`);
    
    if (failedCount > 0) {
      console.log('\nTo retry a specific product, run:');
      console.log(`node import-products.js --index <number> [--category <id>]`);
    }
    
    console.log('\nDone.');
  } catch (error) {
    console.log(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
