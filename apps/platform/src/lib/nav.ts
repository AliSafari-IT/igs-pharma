import { PERMISSIONS, type Permission, hasPermission } from "@igs/rbac";

/**
 * The back-office navigation (igs-pharma#115): what the sidebar lists, grouped, and who sees what.
 * An item with a `permission` shows only to a staff member who holds it; one without (the account
 * page) shows to every signed-in staff member. A group with no visible item is left out. This only
 * decides what is shown: every page and every command still checks its own permission (D-005).
 */
export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly permission?: Permission;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  // the OS look (igs-pharma#197): three groups, the daily work first
  {
    label: "Shop",
    items: [
      { label: "Orders", href: "/orders", permission: PERMISSIONS.orders.read },
      { label: "Stock", href: "/stock", permission: PERMISSIONS.inventory.stockRead },
      { label: "Recalls", href: "/recalls", permission: PERMISSIONS.inventory.stockRead },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { label: "Products", href: "/products", permission: PERMISSIONS.catalog.productsRead },
      { label: "Categories", href: "/categories", permission: PERMISSIONS.catalog.productsRead },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        label: "Data requests",
        href: "/privacy/requests",
        permission: PERMISSIONS.privacy.dsrRead,
      },
      { label: "Consents", href: "/privacy/consents", permission: PERMISSIONS.privacy.consentRead },
      { label: "Staff", href: "/staff", permission: PERMISSIONS.staff.manage },
      {
        label: "Early access",
        href: "/early-access",
        permission: PERMISSIONS.storefront.earlyAccessManage,
      },
      {
        label: "Delivery",
        href: "/settings/delivery",
        permission: PERMISSIONS.orders.deliverySettingsManage,
      },
      // igs-pharma#220: who did what, refused actions included (the owner only)
      { label: "Audit trail", href: "/audit", permission: PERMISSIONS.audit.eventsRead },
      // no permission: every signed-in staff member has an account page
      { label: "Your account", href: "/account" },
    ],
  },
];

/** The groups and items these roles may see. */
export function visibleNav(
  roles: readonly string[],
  can: (roles: readonly string[], permission: Permission) => boolean = hasPermission,
): NavGroup[] {
  return NAV.map((group) => ({
    label: group.label,
    items: group.items.filter(
      (item) => item.permission === undefined || can(roles, item.permission),
    ),
  })).filter((group) => group.items.length > 0);
}

/** Whether `pathname` is this item's page or below it (`/privacy/requests/123` is under Data requests). */
export const isActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);
