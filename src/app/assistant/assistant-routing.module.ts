import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AssistantPage } from './assistant.page';

const routes: Routes = [{ path: '', component: AssistantPage }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AssistantRoutingModule {}
