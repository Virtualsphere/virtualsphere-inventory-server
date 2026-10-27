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

/** A tag: stock counted by quantity only — no serials, no warranty. */
export interface Tag {
  id: string;
  name: string;
  description: string;
  inStock: number;
  /** Sum of every stock intake. */
  totalAdded: number;
  /** Sum given out on hand-overs. */
  totalGiven: number;
  createdAt: string;
  updatedAt: string;
}

/** One "add stock" of a tag or resource. */
export interface StockIntake {
  id: string;
  quantity: number;
  intakeDate: string;
  notes: string;
  createdByName: string | null;
  createdAt: string;
}

/** One hand-over a tag went out on. */
export interface TagGiven {
  dispatchId: string;
  invoiceNo: string;
  customerName: string;
  givenDate: string;
  quantity: number;
}

/** A tag with its stock history, newest first. */
export interface TagDetail extends Tag {
  intakes: StockIntake[];
  given: TagGiven[];
}

/** A resource: a part units are built from, stocked by quantity only. */
export interface Resource {
  id: string;
  name: string;
  description: string;
  inStock: number;
  /** Sum of every stock intake. */
  totalAdded: number;
  /** Sum used by units. */
  totalUsed: number;
  createdAt: string;
  updatedAt: string;
}

/** How much of a resource one module's units used, in total. */
export interface ResourceUsage {
  moduleId: string;
  moduleName: string;
  sku: string;
  productName: string;
  /** Units that used this resource. */
  units: number;
  quantity: number;
}

/** A resource with its stock history: intakes newest first, usage by module. */
export interface ResourceDetail extends Resource {
  intakes: StockIntake[];
  usage: ResourceUsage[];
}

/** How much of one resource a unit was built with. */
export interface UnitResource {
  resourceId: string;
  resourceName: string;
  quantity: number;
}

/** One tag given in a hand-over. */
export interface DispatchTag {
  id: string;
  tagId: string;
  tagName: string;
  quantity: number;
}

/**
 * Stock given out to a customer: one invoice / customer, and one or more
 * modules and/or tags.
 */
export interface Dispatch {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  gstNo: string | null;
  /** Total units across all items. */
  quantity: number;
  items: DispatchItem[];
  /** Total tags across all tag lines. */
  tagQuantity: number;
  tags: DispatchTag[];
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
