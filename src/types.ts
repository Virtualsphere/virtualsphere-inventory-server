export type UnitStatus = "in_stock" | "sold" | "returned" | "defective";

export const UNIT_STATUSES: readonly UnitStatus[] = [
  "in_stock",
  "sold",
  "returned",
  "defective",
] as const;

export interface Product {
  id: string;
  name: string;
  sku: string;
  description: string;
  warrantyMonths: number;
  serialPrefix: string | null;
  nextSeq: number;
  createdAt: string;
  updatedAt: string;
}

/** Product plus denormalized unit counts, for list views. */
export interface ProductWithCounts extends Product {
  totalUnits: number;
  inStock: number;
}

export interface Unit {
  id: string;
  productId: string;
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

/** A unit joined with its product's name and SKU, for list/detail/export. */
export interface UnitView extends Unit {
  productName: string;
  sku: string;
}

/** Stock given out to a customer (one product per record). */
export interface Dispatch {
  id: string;
  invoiceNo: string;
  customerName: string;
  customerPhone: string;
  gstNo: string | null;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
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
