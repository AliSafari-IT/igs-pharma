const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function checkCategories() {
  try {
    // Load config
    const configPath = path.resolve(__dirname, '../setup-data.yml');
    console.log(`Using config from ${configPath}`);
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    
    // Connect to database
    const connection = await mysql.createConnection({
      host: config.database.host,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });
    
    console.log(`Connected to database ${config.database.database} on ${config.database.host}`);
    
    // Check categories table
    const [categories] = await connection.execute('SELECT Id, Name FROM categories');
    console.log('\nCategories in database:');
    if (categories.length === 0) {
      console.log('No categories found in the database.');
    } else {
      categories.forEach(category => {
        console.log(`- ID: ${category.Id}, Name: ${category.Name}`);
      });
    }
    
    // Check suppliers table
    const [suppliers] = await connection.execute('SELECT Id, Name FROM suppliers');
    console.log('\nSuppliers in database:');
    if (suppliers.length === 0) {
      console.log('No suppliers found in the database.');
    } else {
      suppliers.forEach(supplier => {
        console.log(`- ID: ${supplier.Id}, Name: ${supplier.Name}`);
      });
    }
    
    await connection.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

checkCategories();
