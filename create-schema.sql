-- SQL script to create database schema for IGS Pharma
-- Based on C# entity classes from PharmacyDbContext

-- Drop tables in reverse order to avoid foreign key constraints
DROP TABLE IF EXISTS Settings;
DROP TABLE IF EXISTS PurchaseOrderItems;
DROP TABLE IF EXISTS PurchaseOrders;
DROP TABLE IF EXISTS SaleItems;
DROP TABLE IF EXISTS Sales;
DROP TABLE IF EXISTS PrescriptionItems;
DROP TABLE IF EXISTS Prescriptions;
DROP TABLE IF EXISTS InventoryTransactions;
DROP TABLE IF EXISTS Products;
DROP TABLE IF EXISTS Patients;
DROP TABLE IF EXISTS Categories;
DROP TABLE IF EXISTS Suppliers;
DROP TABLE IF EXISTS Doctors;
DROP TABLE IF EXISTS Users;

-- Create Users table
CREATE TABLE Users (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  Username VARCHAR(50) NOT NULL,
  Email VARCHAR(100) NOT NULL,
  PasswordHash VARCHAR(255) NOT NULL,
  FirstName VARCHAR(50) NOT NULL,
  LastName VARCHAR(50) NOT NULL,
  Role VARCHAR(20) NOT NULL,
  IsActive BOOLEAN NOT NULL DEFAULT TRUE,
  LastLoginAt DATETIME,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Users_Username UNIQUE (Username),
  CONSTRAINT UK_Users_Email UNIQUE (Email)
);

-- Create Doctors table
CREATE TABLE Doctors (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  FirstName VARCHAR(100) NOT NULL,
  LastName VARCHAR(100) NOT NULL,
  Email VARCHAR(200) NOT NULL,
  Phone VARCHAR(20) NOT NULL,
  LicenseNumber VARCHAR(50) NOT NULL,
  Specialization VARCHAR(100) NOT NULL,
  Address VARCHAR(500) NOT NULL,
  IsActive BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Doctors_Email UNIQUE (Email),
  CONSTRAINT UK_Doctors_LicenseNumber UNIQUE (LicenseNumber)
);

-- Create Suppliers table
CREATE TABLE Suppliers (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  Name VARCHAR(200) NOT NULL,
  ContactPerson VARCHAR(100) NOT NULL,
  Email VARCHAR(200) NOT NULL,
  Phone VARCHAR(20) NOT NULL,
  Address VARCHAR(500) NOT NULL,
  City VARCHAR(100) NOT NULL,
  PostalCode VARCHAR(20) NOT NULL,
  Country VARCHAR(100) NOT NULL,
  IsActive BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL
);

-- Create Categories table
CREATE TABLE Categories (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  Name VARCHAR(100) NOT NULL,
  Description VARCHAR(500) NOT NULL,
  IsActive BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Categories_Name UNIQUE (Name)
);

-- Create Patients table
CREATE TABLE Patients (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  FirstName VARCHAR(100) NOT NULL,
  LastName VARCHAR(100) NOT NULL,
  Email VARCHAR(200) NOT NULL,
  Phone VARCHAR(20) NOT NULL,
  DateOfBirth DATETIME NOT NULL,
  Gender VARCHAR(10) NOT NULL,
  Address VARCHAR(500) NOT NULL,
  City VARCHAR(100) NOT NULL,
  PostalCode VARCHAR(20) NOT NULL,
  Country VARCHAR(100) NOT NULL,
  InsuranceNumber VARCHAR(50) NOT NULL,
  InsuranceProvider VARCHAR(100) NOT NULL,
  DoctorId INT,
  Allergies VARCHAR(1000) NOT NULL,
  MedicalConditions VARCHAR(1000) NOT NULL,
  IsActive BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Patients_Email UNIQUE (Email),
  CONSTRAINT FK_Patients_Doctors FOREIGN KEY (DoctorId) REFERENCES Doctors (Id) ON DELETE SET NULL
);

-- Create Products table
CREATE TABLE Products (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  Name VARCHAR(200) NOT NULL,
  SKU VARCHAR(50) NOT NULL,
  Barcode VARCHAR(100) NOT NULL,
  Description VARCHAR(1000) NOT NULL,
  ImageUrl VARCHAR(500),
  Price DECIMAL(18, 2) NOT NULL,
  CostPrice DECIMAL(18, 2) NOT NULL,
  CategoryId INT NOT NULL,
  SupplierId INT,
  StockQuantity INT NOT NULL,
  ReorderLevel INT NOT NULL,
  ExpiryDate DATETIME,
  RequiresPrescription BOOLEAN NOT NULL DEFAULT FALSE,
  IsActive BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Products_SKU UNIQUE (SKU),
  CONSTRAINT FK_Products_Categories FOREIGN KEY (CategoryId) REFERENCES Categories (Id) ON DELETE RESTRICT,
  CONSTRAINT FK_Products_Suppliers FOREIGN KEY (SupplierId) REFERENCES Suppliers (Id) ON DELETE SET NULL
);

-- Create InventoryTransactions table
CREATE TABLE InventoryTransactions (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  ProductId INT NOT NULL,
  Quantity INT NOT NULL,
  Type VARCHAR(20) NOT NULL,
  Reason VARCHAR(200) NOT NULL,
  ReferenceNumber VARCHAR(100),
  TransactionDate DATETIME NOT NULL,
  Notes VARCHAR(500),
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT FK_InventoryTransactions_Products FOREIGN KEY (ProductId) REFERENCES Products (Id) ON DELETE CASCADE
);

-- Create Prescriptions table
CREATE TABLE Prescriptions (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  PatientId INT NOT NULL,
  PrescriptionNumber VARCHAR(50) NOT NULL,
  PrescriptionDate DATETIME NOT NULL,
  Notes VARCHAR(1000),
  Status VARCHAR(20) NOT NULL,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Prescriptions_PrescriptionNumber UNIQUE (PrescriptionNumber),
  CONSTRAINT FK_Prescriptions_Patients FOREIGN KEY (PatientId) REFERENCES Patients (Id) ON DELETE CASCADE
);

-- Create PrescriptionItems table
CREATE TABLE PrescriptionItems (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  PrescriptionId INT NOT NULL,
  ProductId INT NOT NULL,
  Quantity INT NOT NULL,
  Dosage VARCHAR(100) NOT NULL,
  Instructions VARCHAR(500) NOT NULL,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT FK_PrescriptionItems_Prescriptions FOREIGN KEY (PrescriptionId) REFERENCES Prescriptions (Id) ON DELETE CASCADE,
  CONSTRAINT FK_PrescriptionItems_Products FOREIGN KEY (ProductId) REFERENCES Products (Id) ON DELETE CASCADE
);

-- Create Sales table
CREATE TABLE Sales (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  InvoiceNumber VARCHAR(50) NOT NULL,
  PatientId INT,
  UserId INT NOT NULL,
  SaleDate DATETIME NOT NULL,
  SubTotal DECIMAL(18, 2) NOT NULL,
  TaxRate DECIMAL(5, 2) NOT NULL,
  TaxAmount DECIMAL(18, 2) NOT NULL,
  DiscountRate DECIMAL(5, 2) NOT NULL,
  DiscountAmount DECIMAL(18, 2) NOT NULL,
  GrandTotal DECIMAL(18, 2) NOT NULL,
  PaymentMethod VARCHAR(20) NOT NULL,
  PaymentStatus VARCHAR(20) NOT NULL,
  PrescriptionId INT,
  Notes VARCHAR(500),
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_Sales_InvoiceNumber UNIQUE (InvoiceNumber),
  CONSTRAINT FK_Sales_Patients FOREIGN KEY (PatientId) REFERENCES Patients (Id) ON DELETE SET NULL,
  CONSTRAINT FK_Sales_Users FOREIGN KEY (UserId) REFERENCES Users (Id) ON DELETE RESTRICT,
  CONSTRAINT FK_Sales_Prescriptions FOREIGN KEY (PrescriptionId) REFERENCES Prescriptions (Id) ON DELETE SET NULL
);

-- Create SaleItems table
CREATE TABLE SaleItems (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  SaleId INT NOT NULL,
  ProductId INT NOT NULL,
  Quantity INT NOT NULL,
  UnitPrice DECIMAL(18, 2) NOT NULL,
  Discount DECIMAL(18, 2) NOT NULL,
  Total DECIMAL(18, 2) NOT NULL,
  Notes VARCHAR(500),
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT FK_SaleItems_Sales FOREIGN KEY (SaleId) REFERENCES Sales (Id) ON DELETE CASCADE,
  CONSTRAINT FK_SaleItems_Products FOREIGN KEY (ProductId) REFERENCES Products (Id) ON DELETE CASCADE
);

-- Create PurchaseOrders table
CREATE TABLE PurchaseOrders (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  OrderNumber VARCHAR(50) NOT NULL,
  SupplierId INT NOT NULL,
  OrderDate DATETIME NOT NULL,
  ExpectedDeliveryDate DATETIME,
  Status VARCHAR(20) NOT NULL,
  SubTotal DECIMAL(18, 2) NOT NULL,
  TaxAmount DECIMAL(18, 2) NOT NULL,
  GrandTotal DECIMAL(18, 2) NOT NULL,
  Notes VARCHAR(500),
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT UK_PurchaseOrders_OrderNumber UNIQUE (OrderNumber),
  CONSTRAINT FK_PurchaseOrders_Suppliers FOREIGN KEY (SupplierId) REFERENCES Suppliers (Id) ON DELETE RESTRICT
);

-- Create PurchaseOrderItems table
CREATE TABLE PurchaseOrderItems (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  PurchaseOrderId INT NOT NULL,
  ProductId INT NOT NULL,
  Quantity INT NOT NULL,
  UnitPrice DECIMAL(18, 2) NOT NULL,
  Total DECIMAL(18, 2) NOT NULL,
  ReceivedQuantity INT NOT NULL,
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL,
  CONSTRAINT FK_PurchaseOrderItems_PurchaseOrders FOREIGN KEY (PurchaseOrderId) REFERENCES PurchaseOrders (Id) ON DELETE CASCADE,
  CONSTRAINT FK_PurchaseOrderItems_Products FOREIGN KEY (ProductId) REFERENCES Products (Id) ON DELETE CASCADE
);

-- Create Settings table
CREATE TABLE Settings (
  Id INT AUTO_INCREMENT PRIMARY KEY,
  PharmacyName VARCHAR(100) NOT NULL,
  Address VARCHAR(500) NOT NULL,
  Phone VARCHAR(20) NOT NULL,
  Email VARCHAR(200) NOT NULL,
  Website VARCHAR(200),
  TaxIdentificationNumber VARCHAR(50) NOT NULL,
  DefaultCurrency VARCHAR(3) NOT NULL,
  DefaultLanguage VARCHAR(5) NOT NULL,
  DefaultTaxRate DECIMAL(5, 2) NOT NULL,
  Logo VARCHAR(500),
  CreatedAt DATETIME NOT NULL,
  UpdatedAt DATETIME NOT NULL
);

-- Insert default admin user
INSERT INTO Users (Username, Email, PasswordHash, FirstName, LastName, Role, IsActive, LastLoginAt, CreatedAt, UpdatedAt)
VALUES ('admin', 'admin@example.com', '$2a$11$9oMCIR.C/4Cg1iRfPGjIR.vuVdnYJPM0/nPXWVvhVCRczcRlKZxS2', 'Admin', 'User', 'Admin', TRUE, NOW(), NOW(), NOW());

-- Insert default categories
INSERT INTO Categories (Name, Description, IsActive, CreatedAt, UpdatedAt)
VALUES 
  ('Prescription Drugs', 'Medications requiring a prescription from a doctor', TRUE, NOW(), NOW()),
  ('Over-the-Counter', 'Medications available without a prescription', TRUE, NOW(), NOW()),
  ('Personal Care', 'Products for personal hygiene and care', TRUE, NOW(), NOW()),
  ('First Aid', 'Products for treating injuries and emergencies', TRUE, NOW(), NOW()),
  ('Vitamins & Supplements', 'Nutritional supplements and vitamins', TRUE, NOW(), NOW());
