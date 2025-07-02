SHOW TABLES;

-- Check some key tables
SELECT COUNT(*) AS UsersCount FROM Users;
SELECT COUNT(*) AS CategoriesCount FROM Categories;
SELECT COUNT(*) AS ProductsCount FROM Products;
SELECT COUNT(*) AS PrescriptionsCount FROM Prescriptions;
SELECT COUNT(*) AS SalesCount FROM Sales;
SELECT COUNT(*) AS InventoryTransactionsCount FROM InventoryTransactions;
SELECT COUNT(*) AS PurchaseOrdersCount FROM PurchaseOrders;
SELECT COUNT(*) AS SuppliersCount FROM Suppliers;
SELECT COUNT(*) AS PatientsCount FROM Patients;
SELECT COUNT(*) AS DoctorsCount FROM Doctors;
SELECT COUNT(*) AS SettingsCount FROM Settings;
