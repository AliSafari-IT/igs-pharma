/**
 * Simple mock data generator for IGS Pharma
 * This script generates mock data for all entities and saves them to JSON files
 */

const fs = require('fs');
const path = require('path');

// Helper functions for generating random data
function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBoolean() {
  return Math.random() > 0.5;
}

function randomDate() {
  const start = new Date(2024, 0, 1).getTime();
  const end = new Date(2025, 6, 2).getTime();
  const date = new Date(start + Math.random() * (end - start));
  return date.toISOString().slice(0, 10) + ' ' + 
    date.toTimeString().slice(0, 8);
}

// Generate Categories (20 items)
function generateCategories() {
  console.log('Generating categories...');
  const categories = [];
  for (let i = 0; i < 20; i++) {
    categories.push({
      Id: null,
      Name: `Category ${i+1}`,
      Description: `Description for category ${i+1}`,
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return categories;
}

// Generate Users (20 items)
function generateUsers() {
  console.log('Generating users...');
  const users = [];
  for (let i = 0; i < 20; i++) {
    users.push({
      Id: null,
      FirstName: `FirstName${i+1}`,
      LastName: `LastName${i+1}`,
      Email: `user${i+1}@example.com`,
      Username: `user${i+1}`,
      Password: "hashed_password_here",
      Role: i % 5, // 0=Admin, 1=Manager, 2=Pharmacist, 3=Technician, 4=Cashier
      Permissions: JSON.stringify(["read:products", "write:products"]),
      IsActive: true,
      CreatedAt: randomDate(),
      UpdatedAt: randomDate()
    });
  }
  return users;
}

// Main function to generate all data
function generateAllData() {
  console.log('Starting simple mock data generation...');
  
  // Generate and save categories
  const categories = generateCategories();
  const categoryFile = path.join(__dirname, 'category-generated.json');
  fs.writeFileSync(categoryFile, JSON.stringify(categories, null, 2));
  console.log(`✓ Saved ${categories.length} categories to ${categoryFile}`);
  
  // Generate and save users
  const users = generateUsers();
  const userFile = path.join(__dirname, 'user-generated.json');
  fs.writeFileSync(userFile, JSON.stringify(users, null, 2));
  console.log(`✓ Saved ${users.length} users to ${userFile}`);
  
  console.log('✅ Simple mock data generation completed!');
}

// Run the generator
generateAllData();
