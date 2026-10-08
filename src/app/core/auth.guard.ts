import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  async canActivate(): Promise<boolean | UrlTree> {
    await this.auth.ready();
    return this.auth.currentUser && this.auth.profile?.companyId
      ? true
      : this.router.parseUrl('/login');
  }
}
