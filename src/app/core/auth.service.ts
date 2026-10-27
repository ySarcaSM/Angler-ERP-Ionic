import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { getAdditionalUserInfo, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, User } from 'firebase/auth';
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
  // Signals notify Angular templates when Firebase finishes outside a UI event.
  private readonly userState = toSignal(this.user$, { initialValue: null });
  private readonly profileState = toSignal(this.profile$, { initialValue: null });
  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>(resolve => this.resolveReady = resolve);
  private authRevision = 0;

  private readonly router = inject(Router);

  constructor() {
    onAuthStateChanged(getFirebaseAuth(), async firebaseUser => {
      // O callback inicial pode ter sido agendado antes do login explícito.
      // Sempre reconcilie com a sessão que o Firebase tem neste momento.
      const user = firebaseUser ?? getFirebaseAuth().currentUser;
      const revision = ++this.authRevision;

      if (!user) {
        this.userSubject.next(null);
        this.profileSubject.next(null);
        this.resolveReady();
        return;
      }

      this.userSubject.next(user);

      // signIn() pode carregar o perfil antes deste callback. Preserve o perfil
      // já verificado para não exibir um estado vazio ao entrar no painel.
      if (this.profile?.uid === user.uid) {
        this.resolveReady();
        return;
      }

      this.profileSubject.next(null);
      const profile = await this.loadProfile(user);
      if (revision !== this.authRevision || getFirebaseAuth().currentUser?.uid !== user.uid) return;

      // O login explícito pode terminar enquanto esta leitura do callback ainda
      // está em andamento. Nesse caso, não sobrescreva o perfil válido com um
      // resultado vazio ou antigo da leitura iniciada primeiro.
      if (this.profile?.uid === user.uid) {
        this.resolveReady();
        return;
      }

      this.profileSubject.next(profile);
      this.resolveReady();
    });
  }

  get currentUser(): User | null { return this.userState(); }
  get profile(): UserProfile | null {
    const profile = this.profileState();
    return profile?.uid === this.userState()?.uid ? profile : null;
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
      throw new Error('Não foi possível identificar sua empresa principal. Se sua conta tiver mais de um vínculo ativo, solicite ao administrador que mantenha apenas o vínculo correto ou defina sua empresa principal.');
    }
    // Invalida leituras iniciadas pelo callback antes deste login para que
    // uma resposta antiga não sobrescreva o perfil recém-verificado.
    ++this.authRevision;
    this.userSubject.next(credential.user);
    this.profileSubject.next(profile);
    this.resolveReady();
    await this.router.navigateByUrl('/home');
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const credential = await signInWithPopup(getFirebaseAuth(), provider);
    const isNewGoogleAccount = getAdditionalUserInfo(credential)?.isNewUser === true;
    const profile = await this.loadProfile(credential.user);

    if (getFirebaseAuth().currentUser?.uid !== credential.user.uid) {
      throw new Error('A sessão foi alterada durante o login. Tente novamente.');
    }
    if (!profile?.companyId) {
      await signOut(getFirebaseAuth());
      if (isNewGoogleAccount) {
        throw new Error('Esta conta Google ainda não está cadastrada no AnglerERP. Crie sua conta em angler-erp.vercel.app e depois entre novamente.');
      }
      throw new Error('Não foi possível identificar sua empresa principal para esta conta Google. Use uma conta vinculada à sua empresa ou peça ao administrador para configurar o vínculo.');
    }

    ++this.authRevision;
    this.userSubject.next(credential.user);
    this.profileSubject.next(profile);
    this.resolveReady();
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
      if (data['active'] === false || data['status'] === 'disabled') return null;

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
    // No sistema original, companyId também pode representar a última empresa
    // selecionada. O login Ionic sempre começa pela empresa que realmente
    // pertence ao usuário, validada por companies/{id}.ownerUid.
    const personalCompanyIds = [
      typeof data['personalCompanyId'] === 'string' ? data['personalCompanyId'] : null,
      ...Object.entries(memberships)
        .filter(([, membership]) => membership.active && membership.personal === true)
        .map(([companyId]) => companyId),
      uid
    ].filter((companyId): companyId is string => !!companyId);

    for (const companyId of [...new Set(personalCompanyIds)]) {
      if (await this.isCompanyOwner(uid, companyId)) return companyId;
    }

    // Contas de funcionários sem empresa própria só entram automaticamente
    // quando possuem exatamente um vínculo ativo. Vínculos múltiplos não
    // escolhem a empresa por meio do contexto salvo em companyId.
    const activeCompanyIds = Object.entries(memberships)
      .filter(([, membership]) => membership.active)
      .map(([companyId]) => companyId);

    if (activeCompanyIds.length === 1) {
      const companyId = activeCompanyIds[0];
      return await this.getVerifiedMembership(uid, companyId, memberships[companyId])
        ? companyId : null;
    }

    // Compatibilidade com perfis legados sem mapa de memberships: aceita o
    // companyId apenas se a associação for verificada diretamente no Firestore.
    if (activeCompanyIds.length === 0 &&
        typeof data['companyId'] === 'string' &&
        data['companyId'].length > 0 &&
        await this.getVerifiedMembership(uid, data['companyId'])) {
      return data['companyId'];
    }

    return null;
  }

  private async getVerifiedMembership(
    uid: string,
    companyId: string,
    membership?: CompanyMembership
  ): Promise<CompanyMembership | null> {
    const db = getFirestoreDb();
    const companySnapshot = await getDoc(doc(db, 'companies', companyId));

    // A propriedade da empresa é a fonte definitiva do papel. O mapa
    // memberships pode estar desatualizado e não pode rebaixar o proprietário.
    if (companySnapshot.exists() && companySnapshot.data()['ownerUid'] === uid) {
      return {
        active: true,
        role: 'owner',
        operatorGroup: membership?.operatorGroup,
        accessRequestId: membership?.accessRequestId
      };
    }

    if (membership?.active === true) return membership;

    const [memberSnapshot, memberIndexSnapshot] = await Promise.all([
      getDoc(doc(db, 'companies', companyId, 'members', uid)),
      getDoc(doc(db, 'companyMembers', `${companyId}_${uid}`))
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
        personal: raw['personal'] === true,
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
