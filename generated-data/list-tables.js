const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function listTables() {
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
    
    // Get all tables
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('\nDatabase Tables:');
    tables.forEach(table => {
      const tableName = Object.values(table)[0];
      console.log(`- ${tableName}`);
    });
    
    // For each table, get its structure
    for (const table of tables) {
      const tableName = Object.values(table)[0];
      console.log(`\nTable: ${tableName}`);
      
      const [columns] = await connection.execute(`DESCRIBE ${tableName}`);
      console.log('Columns:');
      columns.forEach(column => {
        console.log(`  - ${column.Field} (${column.Type})${column.Key === 'PRI' ? ' [PRIMARY KEY]' : ''}${column.Null === 'NO' ? ' [NOT NULL]' : ''}`);
      });
    }
    
    await connection.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

listTables();
