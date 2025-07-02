/**
 * Test file writing for mock data generation
 */

const fs = require('fs');
const path = require('path');

// Simple test data
const testCategories = [
  {
    Id: null,
    Name: "Test Category 1",
    Description: "Test Description 1",
    IsActive: true,
    CreatedAt: "2025-01-01 12:00:00",
    UpdatedAt: "2025-01-01 12:00:00"
  },
  {
    Id: null,
    Name: "Test Category 2",
    Description: "Test Description 2",
    IsActive: true,
    CreatedAt: "2025-01-01 12:00:00",
    UpdatedAt: "2025-01-01 12:00:00"
  }
];

// Simple test data for users
const testUsers = [
  {
    Id: null,
    FirstName: "Test",
    LastName: "User",
    Email: "test@example.com",
    Username: "testuser",
    Password: "hashed_password_here",
    Role: 0,
    Permissions: JSON.stringify(["read:products", "write:products"]),
    IsActive: true,
    CreatedAt: "2025-01-01 12:00:00",
    UpdatedAt: "2025-01-01 12:00:00"
  }
];

// Test function to write files
function testWriteFiles() {
  console.log('Starting test file write...');
  
  // Write categories file
  const categoryFile = path.join(__dirname, 'category-generated.json');
  try {
    fs.writeFileSync(categoryFile, JSON.stringify(testCategories, null, 2));
    console.log(`✓ Successfully wrote ${testCategories.length} categories to ${categoryFile}`);
    
    // Verify file was written correctly
    const categoryContent = fs.readFileSync(categoryFile, 'utf8');
    const parsedCategories = JSON.parse(categoryContent);
    console.log(`✓ Verified file contains ${parsedCategories.length} categories`);
  } catch (error) {
    console.error(`✗ Error writing categories file: ${error.message}`);
  }
  
  // Write users file
  const userFile = path.join(__dirname, 'user-generated.json');
  try {
    fs.writeFileSync(userFile, JSON.stringify(testUsers, null, 2));
    console.log(`✓ Successfully wrote ${testUsers.length} users to ${userFile}`);
    
    // Verify file was written correctly
    const userContent = fs.readFileSync(userFile, 'utf8');
    const parsedUsers = JSON.parse(userContent);
    console.log(`✓ Verified file contains ${parsedUsers.length} users`);
  } catch (error) {
    console.error(`✗ Error writing users file: ${error.message}`);
  }
  
  console.log('Test file write completed!');
}

// Run the test
testWriteFiles();
