-- Check Categories table structure
DESCRIBE Categories;

-- Check Categories data
SELECT * FROM Categories LIMIT 10;

-- Check for any constraints or foreign keys
SELECT 
    TABLE_NAME, 
    COLUMN_NAME, 
    CONSTRAINT_NAME, 
    REFERENCED_TABLE_NAME, 
    REFERENCED_COLUMN_NAME 
FROM 
    INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
WHERE 
    TABLE_SCHEMA = 'igs_pharma_db' 
    AND TABLE_NAME = 'Categories';
