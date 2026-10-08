import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  private readonly auth = inject(AuthService);\n  private readonly router = inject(Router);

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    await this.auth.ready();
    const collectionName = route.data['collection'] as string | undefined;
    if (!collectionName || this.auth.canReadCollection(collectionName)) return true;
    return this.router.parseUrl('/home');
  }
}