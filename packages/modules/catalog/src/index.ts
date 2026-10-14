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
  DEFAULT_EDITOR_VAT_CLASS,
  REGULATED_FIELDS,
  type RegulatedField,
  isMedicine,
  isValidCnk,
  legalStatusFits,
  missingForActivation,
} from "./domain";
export {
  createBrand,
  createProduct,
  createProductRegulated,
  setProductStatus,
  setProductStatusRegulated,
  updateProduct,
  updateProductRegulated,
} from "./commands";
export {
  type BrandView,
  type InconsistentProduct,
  listInconsistentProducts,
  type ProductContentView,
  type ProductListItem,
  type ProductPage,
  type ProductView,
  getProduct,
  listBrands,
  listProducts,
  getProductCounts,
  type ProductCounts,
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
export { canManageRegulated } from "./commands";
export {
  type ProductRef,
  productRefsByCnk,
  productRefsById,
  productRefsForActor,
  searchProductRefs,
  storefrontProductRefsById,
} from "./refs";
export {
  type StorefrontCategory,
  type StorefrontProduct,
  type StorefrontProductItem,
  type StorefrontProductPage,
  getStorefrontProduct,
  listStorefrontCategories,
  listStorefrontProducts,
} from "./storefront";
export { assertSellable, storefrontVisible, storefrontVisibleIds } from "./visibility";
