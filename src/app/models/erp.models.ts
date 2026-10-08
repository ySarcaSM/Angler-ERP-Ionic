export type CompanyRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface UserProfile {
  uid: string;
  email?: string;
  displayName?: string;
  companyId: string;
  role: CompanyRole;
}

export interface ClientRecord {
  id?: string;
  companyId: string;
  name: string;
  document: string;
  email: string;
  phone: string;
  contact: string;
  address: string;
  notes: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProductRecord {
  id?: string;
  companyId: string;
  name: string;
  description: string;
  costPrice: number;
  sellPrice: number;
  stock: {
    current: number;
    minimum: number;
    maximum: number;
    location: string;
  };
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}
