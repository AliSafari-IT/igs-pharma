# IGS Pharmacy Database Setup Guide

## Quick Setup Instructions

### Option 1: Using MySQL Command Line

1. Open MySQL Command Line Client or MySQL Workbench
2. Connect as root user
3. Run the following commands:

```sql
-- Create the database
CREATE DATABASE IF NOT EXISTS igs_pharma_db 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Create the user 'ali' with the specified password
CREATE USER IF NOT EXISTS 'ali'@'localhost' IDENTIFIED BY 'A**+******/';

-- Grant all privileges on the igs_pharma_db database to user 'ali'
GRANT ALL PRIVILEGES ON igs_pharma_db.* TO 'ali'@'localhost';

-- Grant additional privileges for Entity Framework
GRANT CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, SELECT, REFERENCES, RELOAD ON *.* TO 'ali'@'localhost';

-- Apply the privilege changes
FLUSH PRIVILEGES;

-- Verify setup
SHOW DATABASES LIKE 'igs_pharma_db';
SELECT User, Host FROM mysql.user WHERE User = 'ali';
SHOW GRANTS FOR 'ali'@'localhost';
```

### Option 2: Using MySQL Workbench

1. Open MySQL Workbench
2. Connect to your MySQL server as root
3. Go to Server → Users and Privileges
4. Add a new user:
   - Login Name: `ali`
   - Limit to Hosts Matching: `localhost`
   - Password: `A**+******/`
5. Go to Schema Privileges tab
6. Add Entry → Selected schema: Create new schema `igs_pharma_db`
7. Grant all privileges

### Option 3: Command Line with Script

```bash
# Navigate to project directory
cd d:/repos/igs-pharma

# Run the setup script (you'll be prompted for root password)
mysql -u root -p < database-setup.sql
```

## Verification Commands

After setup, verify the database and user:

```sql
-- Test connection with new user
mysql -u ali -p'A**+******/' igs_pharma_db

-- List databases accessible to ali
SHOW DATABASES;

-- Check current database
SELECT DATABASE();
```

## Connection String Verification

Your current connection string in `appsettings.json`:

```json
"DefaultConnection": "Server=localhost;Database=igs_pharma_db;Uid=ali;Pwd=A**+******/;"
```

This should work once the database and user are created.

## Troubleshooting

### Common Issues

1. **Access Denied**: Ensure MySQL service is running
2. **User Already Exists**: Drop and recreate user if needed
3. **Password Issues**: Check for special characters in password
4. **Connection Issues**: Verify MySQL is running on localhost:3306

### Reset Commands (if needed)

```sql
-- Drop user if exists
DROP USER IF EXISTS 'ali'@'localhost';

-- Drop database if exists
DROP DATABASE IF EXISTS igs_pharma_db;

-- Then re-run the creation commands
```

## Next Steps

After database setup:

1. Run Entity Framework migrations
2. Seed initial data
3. Test backend API connection
4. Verify frontend can connect to backend
