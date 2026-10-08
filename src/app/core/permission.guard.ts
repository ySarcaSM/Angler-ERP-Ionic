import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  async canActivate(route: ActivatedRouteSnapshot): Promise<boolean | UrlTree> {
    await this.auth.ready();
    const collectionName = route.data['collection'] as string | undefined;
    if (!collectionName || this.auth.canReadCollection(collectionName)) return true;
    return this.router.parseUrl('/home');
  }
}