export type UnitStatus = "in_stock" | "sold" | "returned" | "defective";

export const UNIT_STATUSES: readonly UnitStatus[] = [
  "in_stock",
  "sold",
  "returned",
  "defective",
] as const;

/** A product: the top-level grouping that several modules belong to. */
export interface Product {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

/** Product plus denormalized module/unit counts, for list views. */
export interface ProductWithCounts extends Product {
  moduleCount: number;
  totalUnits: number;
  inStock: number;
}

/** A module: the stocked item. Units (stock) belong to a module. */
export interface Module {
  id: string;
  productId: string;
  productName: string;
  name: string;
  sku: string;
  description: string;
  warrantyMonths: number;
  serialPrefix: string | null;
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
}

/** Module plus denormalized unit counts, for list views. */
export interface ModuleWithCounts extends Module {
  totalUnits: number;
  inStock: number;
}

export interface Unit {
  id: string;
  moduleId: string;
  seq: number;
  internalSerial: string;
  manufacturerSerial: string | null;
  status: UnitStatus;
  intakeDate: string;
  warrantyStart: string | null;
  warrantyMonths: number;
  soldTo: string | null;
  soldDate: string | null;
  dispatchId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** A unit joined with its module and product, for list/detail/export. */
export interface UnitView extends Unit {
  moduleName: string;
  sku: string;
  productId: string;
  productName: string;
}

/** One module given in a hand-over. */
export interface DispatchItem {
  id: string;
  moduleId: string;
  moduleName: string;
  sku: string;
  productId: string;
  productName: string;
  quantity: number;
}

/** Stock given out to a customer: one invoice / customer, one or more modules. */
export interface Dispatch {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  gstNo: string | null;
  /** Total units across all items. */
  quantity: number;
  items: DispatchItem[];
  givenDate: string;
  validUntil: string | null;
  notes: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** A dispatch plus the units that went out with it. */
export interface DispatchDetail extends Dispatch {
  units: UnitView[];
}

export interface Settings {
  companyName: string;
  serialPrefix: string;
  defaultWarrantyMonths: number;
  lowStockThreshold: number;
  updatedAt: string;
}

export type UserRole = "admin" | "user";

/** A user account as exposed by the API — never includes the password hash. */
export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
