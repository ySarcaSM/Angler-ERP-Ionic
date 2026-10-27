import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { User } from 'firebase/auth';
import { vi } from 'vitest';
import { AuthService } from './auth.service';

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn()
}));
vi.mock('./firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
  getFirestoreDb: vi.fn()
}));

@Component({
  standalone: true,
  template: '{{ auth.profile?.role || "loading" }}'
})
class AuthStateHostComponent {
  readonly auth = inject(AuthService);
}

describe('AuthService template reactivity', () => {
  it('updates delayed profile and logout without navigation or manual change detection', async () => {
    TestBed.configureTestingModule({
      imports: [AuthStateHostComponent],
      providers: [{ provide: Router, useValue: { navigateByUrl: vi.fn() } }]
    });
    const fixture = TestBed.createComponent(AuthStateHostComponent);
    const auth = TestBed.inject(AuthService);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('loading');

    await Promise.resolve();
    auth['userSubject'].next({ uid: 'owner-uid' } as User);
    auth['profileSubject'].next({
      uid: 'owner-uid', companyId: 'company-a', role: 'owner',
      memberships: { 'company-a': { active: true, role: 'owner' } }
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe('owner');

    auth['userSubject'].next(null);
    auth['profileSubject'].next(null);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe('loading');
  });
});
