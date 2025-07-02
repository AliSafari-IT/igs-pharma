const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function checkProductIds() {
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
    
    // Check product IDs
    console.log('\n=== Product IDs in Database ===');
    const [products] = await connection.execute(`
      SELECT Id, Name, Barcode
      FROM products
      ORDER BY Id
      LIMIT 50
    `);
    
    products.forEach(product => {
      console.log(`ID: ${product.Id}, Name: ${product.Name}, Barcode: ${product.Barcode}`);
    });
    
    // Count products
    const [productCount] = await connection.execute(`
      SELECT COUNT(*) as count FROM products
    `);
    console.log(`\nTotal products in database: ${productCount[0].count}`);
    
    // Check prescription IDs
    console.log('\n=== Prescription IDs in Database ===');
    const [prescriptions] = await connection.execute(`
      SELECT Id, PrescriptionNumber
      FROM prescriptions
      ORDER BY Id
      LIMIT 50
    `);
    
    prescriptions.forEach(prescription => {
      console.log(`ID: ${prescription.Id}, Number: ${prescription.PrescriptionNumber}`);
    });
    
    // Count prescriptions
    const [prescriptionCount] = await connection.execute(`
      SELECT COUNT(*) as count FROM prescriptions
    `);
    console.log(`\nTotal prescriptions in database: ${prescriptionCount[0].count}`);
    
    await connection.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

checkProductIds();
