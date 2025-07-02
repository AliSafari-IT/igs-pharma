/**
 * Data Validation Utility
 * 
 * This utility validates and transforms generated data to ensure it complies with database constraints
 */

const fs = require('fs');
const path = require('path');

// Simple logger functions
const logger = {
  info: (message) => console.log('ℹ ' + message),
  success: (message) => console.log('✓ ' + message),
  warning: (message) => console.log('⚠ ' + message),
  error: (message) => console.log('✗ ' + message)
};

// Entity constraints based on C# model attributes
const entityConstraints = {
  Categories: {
    Name: { maxLength: 100 },
    Description: { maxLength: 500 }
  },
  Doctors: {
    FirstName: { maxLength: 100 },
    LastName: { maxLength: 100 },
    Email: { maxLength: 200 },
    Phone: { maxLength: 20 },
    Specialization: { maxLength: 100 },
    LicenseNumber: { maxLength: 50 }
  },
  Products: {
    Name: { maxLength: 100 },
    Description: { maxLength: 500 },
    SKU: { maxLength: 50 },
    Barcode: { maxLength: 50 },
    Manufacturer: { maxLength: 100 },
    BatchNumber: { maxLength: 50 }
  },
  Users: {
    Username: { maxLength: 50 },
    Email: { maxLength: 200 },
    FirstName: { maxLength: 100 },
    LastName: { maxLength: 100 },
    Phone: { maxLength: 20 },
    LicenseNumber: { maxLength: 50 },
    Department: { maxLength: 100 },
    EmployeeId: { maxLength: 50 },
    CardId: { maxLength: 50 }
  },
  Patients: {
    FirstName: { maxLength: 100 },
    LastName: { maxLength: 100 },
    Email: { maxLength: 200 },
    Phone: { maxLength: 20 },
    Address: { maxLength: 200 },
    InsuranceProvider: { maxLength: 100 },
    InsuranceNumber: { maxLength: 50 }
  },
  Suppliers: {
    Name: { maxLength: 100 },
    ContactPerson: { maxLength: 100 },
    Email: { maxLength: 200 },
    Phone: { maxLength: 20 },
    Address: { maxLength: 200 },
    TaxId: { maxLength: 50 },
    Notes: { maxLength: 500 }
  },
  PrescriptionItems: {
    Instructions: { maxLength: 500 },
    Notes: { maxLength: 500 }
  },
  PurchaseOrders: {
    OrderNumber: { maxLength: 50 },
    Notes: { maxLength: 500 }
  },
  Sales: {
    InvoiceNumber: { maxLength: 50 },
    Notes: { maxLength: 500 }
  },
  InventoryTransactions: {
    ReferenceNumber: { maxLength: 50 },
    Notes: { maxLength: 500 }
  }
};

/**
 * Validate and transform data for an entity
 * @param {string} entityName - Name of the entity (table)
 * @param {Array} data - Array of entity objects
 * @returns {Array} - Validated and transformed data
 */
function validateEntityData(entityName, data) {
  const constraints = entityConstraints[entityName] || {};
  const validatedData = [];
  const warnings = [];
  const usedEmails = new Set(); // Track used emails to ensure uniqueness

  data.forEach((item, index) => {
    const validatedItem = { ...item };

    // Special handling for Users entity - serialize Permissions as JSON string
    if (entityName === 'Users' && validatedItem.Permissions) {
      if (Array.isArray(validatedItem.Permissions)) {
        validatedItem.Permissions = JSON.stringify(validatedItem.Permissions);
      }
    }

    // Ensure unique emails for Doctors
    if (entityName === 'Doctors' && validatedItem.Email) {
      let originalEmail = validatedItem.Email;
      let counter = 1;
      
      // If email already exists, add a suffix until it's unique
      while (usedEmails.has(validatedItem.Email)) {
        const emailParts = originalEmail.split('@');
        validatedItem.Email = `${emailParts[0]}${counter}@${emailParts[1]}`;
        counter++;
      }
      
      usedEmails.add(validatedItem.Email);
    }

    // Handle specific entity issues like foreign keys and unknown columns
    switch (entityName) {
      case 'Patients':
        if (validatedItem.DoctorId === null || validatedItem.DoctorId === undefined) {
          delete validatedItem.DoctorId;
        }
        break;
      case 'Prescriptions':
        if (validatedItem.Patient !== undefined) {
          delete validatedItem.Patient;
        }
        break;
      case 'PrescriptionItems':
      case 'PurchaseOrders':
      case 'Sales':
      case 'SaleItems':
      case 'Settings':
        if ('IsActive' in validatedItem && entityName !== 'Users' && entityName !== 'Categories' && entityName !== 'Products') {
          delete validatedItem.IsActive;
        }
        break;
    }

    // Apply constraints to each field
    Object.keys(constraints).forEach(field => {
      const constraint = constraints[field];
      
      // Skip if field doesn't exist in the item
      if (validatedItem[field] === undefined || validatedItem[field] === null) {
        return;
      }
      
      // Apply string length constraints
      if (typeof validatedItem[field] === 'string' && constraint.maxLength) {
        if (validatedItem[field].length > constraint.maxLength) {
          logger.warning(`Warning: Truncating ${field} in ${entityName} from ${validatedItem[field].length} to ${constraint.maxLength} characters.`);
          validatedItem[field] = validatedItem[field].substring(0, constraint.maxLength);
        }
      }
    });
    
    return validatedItem;
  });
  
  return validatedData;
}

/**
 * Map file names to entity names with correct pluralization
 */
const entityNameMap = {
  'category': 'Categories',
  'doctor': 'Doctors',
  'inventorytransaction': 'InventoryTransactions',
  'patient': 'Patients',
  'prescription': 'Prescriptions',
  'prescriptionitem': 'PrescriptionItems',
  'product': 'Products',
  'purchaseorder': 'PurchaseOrders',
  'sale': 'Sales',
  'saleitem': 'SaleItems',
  'settings': 'Settings',
  'supplier': 'Suppliers',
  'user': 'Users'
};

/**
 * Validate and transform all data files
 */
function validateAllData() {
  const dataDir = path.resolve(__dirname);
  const dataFiles = fs.readdirSync(dataDir).filter(file => file.endsWith('-generated.json'));
  
  dataFiles.forEach(file => {
    const fileBaseName = file.replace('-generated.json', '');
    const tableName = entityNameMap[fileBaseName] || 
                     (fileBaseName.charAt(0).toUpperCase() + fileBaseName.slice(1) + 's');
    
    try {
      const filePath = path.join(dataDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      logger.info(`Validating ${data.length} items in ${tableName}...`);
      const validatedData = validateEntityData(tableName, data);
      
      // Write back the validated data
      fs.writeFileSync(filePath, JSON.stringify(validatedData, null, 2));
      logger.success(`Successfully validated and updated ${tableName} data`);
    } catch (error) {
      logger.error(`Error processing ${file}: ${error.message}`);
    }
  });
}

// If called directly
if (require.main === module) {
  validateAllData();
}

module.exports = {
  validateEntityData,
  validateAllData
};
