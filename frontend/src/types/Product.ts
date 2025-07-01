export interface Product {
  id: number;
  name: string;
  description: string;
  sku: string;
  barcode: string;
  price: number;
  costPrice: number;
  stockQuantity: number;
  minStockLevel: number;
  maxStockLevel: number;
  expiryDate?: string;
  manufactureDate?: string;
  manufacturer: string;
  batchNumber: string;
  requiresPrescription: boolean;
  isActive: boolean;
  categoryId: number;
  categoryName: string;
  supplierId?: number;
  supplierName: string;
  createdAt: string;
  updatedAt: string;
  isLowStock: boolean;
  isExpiringSoon: boolean;
}

export interface CreateProduct {
  Name: string;
  Description: string;
  SKU: string;
  Barcode: string;
  Price: number;
  CostPrice: number;
  StockQuantity: number;
  MinStockLevel: number;
  MaxStockLevel: number;
  ExpiryDate?: string;
  ManufactureDate?: string;
  Manufacturer: string;
  BatchNumber: string;
  RequiresPrescription: boolean;
  CategoryId: number;
  SupplierId?: number;
}

export interface UpdateProduct {
  Name: string;
  Description: string;
  SKU: string;
  Barcode: string;
  Price: number;
  CostPrice: number;
  StockQuantity: number;
  MinStockLevel: number;
  MaxStockLevel: number;
  ExpiryDate?: string;
  ManufactureDate?: string;
  Manufacturer: string;
  BatchNumber: string;
  RequiresPrescription: boolean;
  IsActive: boolean;
  CategoryId: number;
  SupplierId?: number;
}

export interface UpdateStockRequest {
  quantity: number;
  reason: string;
}
