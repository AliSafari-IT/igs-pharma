export * as catalogSchema from "./schema";
export {
  CONTENT_LOCALES,
  type ContentLocale,
  LEGAL_STATUSES,
  type LegalStatus,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type ProductStatus,
  type ProductType,
  REQUIRED_LOCALES,
  VAT_CLASSES,
  type VatClass,
  MAX_CATEGORIES_PER_PRODUCT,
  MAX_CATEGORY_DEPTH,
  isValidCnk,
  missingForActivation,
} from "./domain";
export { createBrand, createProduct, setProductStatus, updateProduct } from "./commands";
export {
  type BrandView,
  type ProductContentView,
  type ProductListItem,
  type ProductPage,
  type ProductView,
  getProduct,
  listBrands,
  listProducts,
} from "./queries";
export {
  type CategoryNode,
  createCategory,
  deleteCategory,
  listCategories,
  moveCategory,
  setProductCategories,
  updateCategory,
} from "./categories";
export { CATALOG_AUDIT, type RegisterAuditAction, registerAuditActions } from "./audit";
export { type ProductRef, productRefsByCnk, productRefsById, searchProductRefs } from "./refs";
