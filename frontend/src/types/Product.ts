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
  categoryId: number;
  supplierId?: number;
}

export interface UpdateProduct {
  name: string;
  description: string;
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
  supplierId?: number;
}

export interface UpdateStockRequest {
  quantity: number;
  reason: string;
}
