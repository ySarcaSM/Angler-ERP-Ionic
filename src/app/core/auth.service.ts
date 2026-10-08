import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from './firebase';
import { CompanyMembership, CompanyRole, OperatorGroup, UserProfile } from '../models/erp.models';

const READ_GROUPS: Record<OperatorGroup, readonly string[]> = {
  management: ['clients', 'products', 'sales', 'purchases', 'suppliers', 'locations', 'stockMovements', 'counters'],
  financial: ['financialTransactions', 'sales', 'purchases', 'products', 'stockMovements', 'counters'],
  budgets: ['budgets', 'formulas', 'clients']
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly userSubject = new BehaviorSubject<User | null>(null);
  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  readonly user$ = this.userSubject.asObservable();
  readonly profile$ = this.profileSubject.asObservable();
  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>(resolve => this.resolveReady = resolve);

  constructor(private readonly router: Router) {
    onAuthStateChanged(firebaseAuth, async user => {
      this.userSubject.next(user);
      const profile = user ? await this.loadProfile(user) : null;
      this.profileSubject.next(profile);
      this.resolveReady();
    });
  }

  get currentUser(): User | null { return this.userSubject.value; }
  get profile(): UserProfile | null { return this.profileSubject.value; }
  get companyId(): string | null { return this.profile?.companyId ?? null; }
  get role(): CompanyRole { return this.profile?.role ?? 'viewer'; }
  get operatorGroup(): OperatorGroup | null {
    const companyId = this.companyId;
    if (!companyId || this.role !== 'operator') return null;
    return this.profile?.memberships[companyId]?.operatorGroup ?? null;
  }

  ready(): Promise<void> { return this.readyPromise; }

  async signIn(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    const profile = await this.loadProfile(credential.user);
    if (!profile?.companyId) {
      await signOut(firebaseAuth);
      throw new Error('Seu usuário não está associado a uma empresa. Solicite acesso ao administrador.');
    }
    this.userSubject.next(credential.user);
    this.profileSubject.next(profile);
    await this.router.navigateByUrl('/home');
  }

  async signOut(): Promise<void> {
    await signOut(firebaseAuth);
    this.userSubject.next(null);
    this.profileSubject.next(null);
    await this.router.navigateByUrl('/login');
  }

  isSuperAdmin(): boolean {
    return this.currentUser?.email === 'admin@angler-erp.local';
  }

  canReadCollection(collectionName: string): boolean {
    if (this.isSuperAdmin()) return true;
    const profile = this.profile;
    if (!profile?.companyId) return false;
    if (profile.role !== 'operator') return true;
    const group = profile.memberships[profile.companyId]?.operatorGroup;
    return !!group && READ_GROUPS[group].includes(collectionName);
  }

  canWriteCollection(_collectionName: string): boolean {
    if (this.isSuperAdmin()) return true;
    return ['owner', 'admin', 'operator'].includes(this.role);
  }

  canWrite(): boolean {
    return this.canWriteCollection('');
  }

  canDelete(): boolean {
    if (this.isSuperAdmin()) return true;
    return ['owner', 'admin'].includes(this.role);
  }

  private async loadProfile(user: User): Promise<UserProfile | null> {
    try {
      const snapshot = await getDoc(doc(firestore, 'users', user.uid));
      if (!snapshot.exists()) return null;

      const data = snapshot.data();
      const memberships = this.normalizeMemberships(data['memberships']);
      const companyId = this.resolveCompanyId(data, memberships);
      if (!companyId) return null;

      const membership = memberships[companyId];
      const role = membership?.active ? membership.role : this.normalizeRole(data['role']);

      return {
        uid: user.uid,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        companyId,
        role,
        memberships
      };
    } catch (error) {
      console.error('Não foi possível carregar o perfil da empresa.', error);
      return null;
    }
  }

  private resolveCompanyId(data: Record<string, any>, memberships: Record<string, CompanyMembership>): string | null {
    if (typeof data['companyId'] === 'string' && data['companyId'].length) return data['companyId'];
    const activeMembership = Object.entries(memberships).find(([, membership]) => membership.active);
    return activeMembership?.[0] ?? null;
  }

  private normalizeMemberships(value: unknown): Record<string, CompanyMembership> {
    if (!value || typeof value !== 'object') return {};
    const result: Record<string, CompanyMembership> = {};

    for (const [companyId, raw] of Object.entries(value as Record<string, any>)) {
      if (!raw || typeof raw !== 'object') continue;
      const role = this.normalizeRole(raw['role']);
      result[companyId] = {
        active: raw['active'] === true,
        role,
        operatorGroup: this.normalizeOperatorGroup(raw['operatorGroup']),
        accessRequestId: typeof raw['accessRequestId'] === 'string' ? raw['accessRequestId'] : undefined
      };
    }
    return result;
  }

  private normalizeRole(role: unknown): CompanyRole {
    return role === 'owner' || role === 'admin' || role === 'manager' || role === 'operator' || role === 'viewer'
      ? role : 'viewer';
  }

  private normalizeOperatorGroup(group: unknown): OperatorGroup | undefined {
    return group === 'management' || group === 'financial' || group === 'budgets' ? group : undefined;
  }
}