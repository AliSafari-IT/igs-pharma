const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function validateImport() {
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
    
    // Tables to check
    const tables = ['categories', 'users', 'products', 'suppliers', 'doctors', 'patients', 'prescriptions', 'prescription_items', 'settings', 'sales', 'sales_items', 'sales_payments', 'sales_payments_items'];
    
    console.log('\n=== Import Validation Results ===');
    
    // For each table, count records
    for (const tableName of tables) {
      try {
        const [rows] = await connection.execute(`SELECT COUNT(*) as count FROM ${tableName}`);
        console.log(`✅ ${tableName}: ${rows[0].count} records`);
        
        // Get a sample record
        const [sample] = await connection.execute(`SELECT * FROM ${tableName} LIMIT 1`);
        if (sample.length > 0) {
          console.log(`   Sample record fields: ${Object.keys(sample[0]).join(', ')}`);
        }
      } catch (error) {
        console.error(`❌ Error checking table ${tableName}: ${error.message}`);
      }
    }
    
    await connection.end();
    console.log('\n✅ Validation complete!');
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

validateImport();
