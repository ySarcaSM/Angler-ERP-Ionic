import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { firebaseAuth, firestore } from './firebase';
import { UserProfile } from '../models/erp.models';

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
      let profile: UserProfile | null = null;
      if (user) profile = await this.loadProfile(user);
      this.profileSubject.next(profile);
      this.resolveReady();
    });
  }

  get currentUser(): User | null { return this.userSubject.value; }
  get profile(): UserProfile | null { return this.profileSubject.value; }
  get companyId(): string | null { return this.profile?.companyId ?? null; }
  get role(): string { return this.profile?.role ?? 'viewer'; }

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

  canWrite(): boolean {
    return ['owner', 'admin', 'operator'].includes(this.role);
  }

  canDelete(): boolean {
    return ['owner', 'admin'].includes(this.role);
  }

  private async loadProfile(user: User): Promise<UserProfile | null> {
    try {
      const snapshot = await getDoc(doc(firestore, 'users', user.uid));
      if (!snapshot.exists()) return null;
      const data = snapshot.data();
      if (typeof data['companyId'] !== 'string' || !data['companyId'].length) return null;
      return {
        uid: user.uid,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        companyId: data['companyId'],
        role: this.normalizeRole(data['role'])
      };
    } catch (error) {
      console.error('Não foi possível carregar o perfil da empresa.', error);
      return null;
    }
  }

  private normalizeRole(role: unknown): UserProfile['role'] {
    return role === 'owner' || role === 'admin' || role === 'operator' || role === 'viewer'
      ? role : 'viewer';
  }
}
