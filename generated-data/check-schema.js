const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function checkSchema() {
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
    const tables = ['categories', 'users', 'products', 'suppliers', 'doctors', 'patients'];
    
    // For each table, get its structure
    for (const tableName of tables) {
      try {
        console.log(`\n=== Table: ${tableName} ===`);
        
        const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
        console.log('Columns:');
        columns.forEach(column => {
          console.log(`  - ${column.Field} (${column.Type})${column.Key === 'PRI' ? ' [PRIMARY KEY]' : ''}${column.Null === 'NO' ? ' [NOT NULL]' : ''}${column.Default ? ` [DEFAULT: ${column.Default}]` : ''}`);
        });
        
        // Check foreign keys
        const [foreignKeys] = await connection.execute(`
          SELECT 
            COLUMN_NAME, 
            REFERENCED_TABLE_NAME, 
            REFERENCED_COLUMN_NAME 
          FROM 
            INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
          WHERE 
            TABLE_SCHEMA = '${config.database.database}' AND 
            TABLE_NAME = '${tableName}' AND 
            REFERENCED_TABLE_NAME IS NOT NULL
        `);
        
        if (foreignKeys.length > 0) {
          console.log('\nForeign Keys:');
          foreignKeys.forEach(fk => {
            console.log(`  - ${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`);
          });
        }
      } catch (error) {
        console.error(`Error checking table ${tableName}: ${error.message}`);
      }
    }
    
    await connection.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

checkSchema();
