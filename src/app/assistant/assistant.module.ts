import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { AssistantPage } from './assistant.page';
import { AssistantRoutingModule } from './assistant-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, AssistantRoutingModule],
  declarations: [AssistantPage]
})
export class AssistantPageModule {}
