import { inject, Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  private readonly auth = inject(AuthService);\n  private readonly router = inject(Router);

  async canActivate(): Promise<boolean | UrlTree> {
    await this.auth.ready();
    return this.auth.currentUser && this.auth.profile?.companyId
      ? true
      : this.router.parseUrl('/login');
  }
}
