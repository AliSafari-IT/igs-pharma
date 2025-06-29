-- IGS Pharmacy Management System Database Setup
-- This script creates the database and user as specified in appsettings.json

-- Create the database
CREATE DATABASE IF NOT EXISTS igs_pharma_db 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Create the user 'ali' with the specified password
CREATE USER IF NOT EXISTS 'ali'@'localhost' IDENTIFIED BY 'Ali+123456/';

-- Grant all privileges on the igs_pharma_db database to user 'ali'
GRANT ALL PRIVILEGES ON igs_pharma_db.* TO 'ali'@'localhost';

-- Grant additional privileges that might be needed for Entity Framework
GRANT CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, SELECT, REFERENCES, RELOAD ON *.* TO 'ali'@'localhost';

-- Apply the privilege changes
FLUSH PRIVILEGES;

-- Verify the database was created
SHOW DATABASES LIKE 'igs_pharma_db';

-- Verify the user was created
SELECT User, Host FROM mysql.user WHERE User = 'ali';

-- Show granted privileges for the user
SHOW GRANTS FOR 'ali'@'localhost';

-- Use the database for any additional setup
USE igs_pharma_db;

-- Display success message
SELECT 'Database igs_pharma_db and user ali created successfully!' AS Status;
