import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirestoreDb } from './firebase';
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
  private authRevision = 0;

  private readonly router = inject(Router);

  constructor() {
    onAuthStateChanged(getFirebaseAuth(), async user => {
      const revision = ++this.authRevision;
      this.userSubject.next(user);
      this.profileSubject.next(null);

      if (!user) {
        this.resolveReady();
        return;
      }

      const profile = await this.loadProfile(user);
      if (revision !== this.authRevision || getFirebaseAuth().currentUser?.uid !== user.uid) return;

      this.profileSubject.next(profile);
      this.resolveReady();
    });
  }

  get currentUser(): User | null { return this.userSubject.value; }
  get profile(): UserProfile | null {
    const profile = this.profileSubject.value;
    return profile?.uid === this.userSubject.value?.uid ? profile : null;
  }
  get companyId(): string | null { return this.profile?.companyId ?? null; }
  get role(): CompanyRole { return this.profile?.role ?? 'viewer'; }
  get operatorGroup(): OperatorGroup | null {
    const companyId = this.companyId;
    if (!companyId || this.role !== 'operator') return null;
    return this.profile?.memberships[companyId]?.operatorGroup ?? null;
  }

  ready(): Promise<void> { return this.readyPromise; }

  async signIn(email: string, password: string): Promise<void> {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    const profile = await this.loadProfile(credential.user);
    if (getFirebaseAuth().currentUser?.uid !== credential.user.uid) {
      throw new Error('A sessão foi alterada durante o login. Tente novamente.');
    }
    if (!profile?.companyId) {
      await signOut(getFirebaseAuth());
      throw new Error('Seu usuário não possui vínculo ativo com uma empresa. Solicite acesso ao administrador.');
    }
    this.userSubject.next(credential.user);
    this.profileSubject.next(profile);
    await this.router.navigateByUrl('/home');
  }

  async signOut(): Promise<void> {
    ++this.authRevision;
    this.userSubject.next(null);
    this.profileSubject.next(null);
    await signOut(getFirebaseAuth());
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
      const snapshot = await getDoc(doc(getFirestoreDb(), 'users', user.uid));
      if (!snapshot.exists()) return null;

      const data = snapshot.data();
      if (data['active'] === false) return null;

      const memberships = this.normalizeMemberships(data['memberships']);
      const companyId = await this.resolveCompanyId(user.uid, data, memberships);
      if (!companyId) return null;

      const membership = await this.getVerifiedMembership(user.uid, companyId, memberships[companyId]);
      if (!membership) return null;
      memberships[companyId] = membership;

      return {
        uid: user.uid,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        companyId,
        role: membership.role,
        memberships
      };
    } catch (error) {
      console.error('Não foi possível carregar o perfil da empresa.', error);
      return null;
    }
  }

  private async resolveCompanyId(
    uid: string,
    data: Record<string, any>,
    memberships: Record<string, CompanyMembership>
  ): Promise<string | null> {
    const explicitCompanyId = typeof data['companyId'] === 'string' && data['companyId'].length
      ? data['companyId'] : null;
    if (explicitCompanyId && await this.getVerifiedMembership(uid, explicitCompanyId, memberships[explicitCompanyId])) {
      return explicitCompanyId;
    }

    const personalCompanyId = typeof data['personalCompanyId'] === 'string' && data['personalCompanyId'].length
      ? data['personalCompanyId'] : uid;
    if (await this.isCompanyOwner(uid, personalCompanyId)) return personalCompanyId;

    const activeCompanyIds = Object.entries(memberships)
      .filter(([, membership]) => membership.active)
      .map(([companyId]) => companyId);
    if (activeCompanyIds.length === 1 &&
        await this.getVerifiedMembership(uid, activeCompanyIds[0], memberships[activeCompanyIds[0]])) {
      return activeCompanyIds[0];
    }

    return null;
  }

  private async getVerifiedMembership(
    uid: string,
    companyId: string,
    membership?: CompanyMembership
  ): Promise<CompanyMembership | null> {
    if (membership?.active === true) return membership;

    const db = getFirestoreDb();
    const [memberSnapshot, memberIndexSnapshot, companySnapshot] = await Promise.all([
      getDoc(doc(db, 'companies', companyId, 'members', uid)),
      getDoc(doc(db, 'companyMembers', `${companyId}_${uid}`)),
      getDoc(doc(db, 'companies', companyId))
    ]);

    const member = memberSnapshot.exists() && memberSnapshot.data()['active'] === true
      ? memberSnapshot.data()
      : memberIndexSnapshot.exists() && memberIndexSnapshot.data()['active'] === true
        ? memberIndexSnapshot.data()
        : null;
    if (member) {
      return {
        active: true,
        role: this.normalizeRole(member['role']),
        operatorGroup: membership?.operatorGroup,
        accessRequestId: membership?.accessRequestId
      };
    }

    if (companySnapshot.exists() && companySnapshot.data()['ownerUid'] === uid) {
      return { active: true, role: 'owner' };
    }

    return null;
  }

  private async isCompanyOwner(uid: string, companyId: string): Promise<boolean> {
    const snapshot = await getDoc(doc(getFirestoreDb(), 'companies', companyId));
    return snapshot.exists() && snapshot.data()['ownerUid'] === uid;
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
