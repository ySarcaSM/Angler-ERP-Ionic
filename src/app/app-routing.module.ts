import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { AuthGuard } from './core/auth.guard';
import { PermissionGuard } from './core/permission.guard';

const routes: Routes = [
  { path: 'login', loadChildren: () => import('./login/login.module').then(m => m.LoginPageModule) },
  { path: 'home', canActivate: [AuthGuard], loadChildren: () => import('./home/home.module').then(m => m.HomePageModule) },
  { path: 'assistente', canActivate: [AuthGuard], loadChildren: () => import('./assistant/assistant.module').then(m => m.AssistantPageModule) },
  {
    path: 'clientes',
    canActivate: [AuthGuard, PermissionGuard],
    data: { collection: 'clients' },
    loadChildren: () => import('./clients/clients.module').then(m => m.ClientsPageModule)
  },
  {
    path: 'produtos',
    canActivate: [AuthGuard, PermissionGuard],
    data: { collection: 'products' },
    loadChildren: () => import('./products/products.module').then(m => m.ProductsPageModule)
  },
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  { path: '**', redirectTo: 'home' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule]
})
export class AppRoutingModule {}