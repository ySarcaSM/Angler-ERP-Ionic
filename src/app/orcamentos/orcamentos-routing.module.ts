import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OrcamentosPage } from './orcamentos.page';

const routes: Routes = [{ path: '', component: OrcamentosPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class OrcamentosRoutingModule {}
