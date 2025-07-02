const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mysql = require('mysql2/promise');

async function checkDoctors() {
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
    
    // Check doctors table
    const [doctors] = await connection.execute('SELECT Id, FirstName, LastName FROM doctors');
    console.log('\nDoctors in database:');
    if (doctors.length === 0) {
      console.log('No doctors found in the database.');
    } else {
      doctors.forEach(doctor => {
        console.log(`- ID: ${doctor.Id}, Name: ${doctor.FirstName} ${doctor.LastName}`);
      });
    }
    
    await connection.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

checkDoctors();
