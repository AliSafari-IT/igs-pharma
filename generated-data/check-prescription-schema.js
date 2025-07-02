const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function checkPrescriptionSchema() {
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
    
    // Check prescriptions table
    console.log('\n=== Prescriptions Table Schema ===');
    const [prescriptionColumns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'prescriptions'
      ORDER BY ORDINAL_POSITION
    `, [config.database.database]);
    
    prescriptionColumns.forEach(col => {
      console.log(`${col.COLUMN_NAME} (${col.DATA_TYPE}) ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'} ${col.COLUMN_KEY}`);
    });
    
    // Check prescriptionitems table
    console.log('\n=== PrescriptionItems Table Schema ===');
    const [prescriptionItemColumns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'prescriptionitems'
      ORDER BY ORDINAL_POSITION
    `, [config.database.database]);
    
    prescriptionItemColumns.forEach(col => {
      console.log(`${col.COLUMN_NAME} (${col.DATA_TYPE}) ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'} ${col.COLUMN_KEY}`);
    });
    
    // Check foreign keys
    console.log('\n=== PrescriptionItems Foreign Keys ===');
    const [prescriptionItemFKs] = await connection.execute(`
      SELECT 
        CONSTRAINT_NAME,
        COLUMN_NAME,
        REFERENCED_TABLE_NAME,
        REFERENCED_COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'prescriptionitems'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `, [config.database.database]);
    
    prescriptionItemFKs.forEach(fk => {
      console.log(`${fk.CONSTRAINT_NAME}: ${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}(${fk.REFERENCED_COLUMN_NAME})`);
    });
    
    await connection.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

checkPrescriptionSchema();
