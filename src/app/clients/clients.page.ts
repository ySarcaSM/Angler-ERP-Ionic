import { Component, inject, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular/lazy';
import { AuthService } from '../core/auth.service';
import { ClientRecord } from '../models/erp.models';
import { ClientsService } from '../services/clients.service';

type ClientForm = Omit<ClientRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>;

const emptyClient = (): ClientForm => ({
  name: '', document: '', email: '', phone: '', contact: '', address: '', notes: '', active: true
});

@Component({
  selector: 'app-clients',
  templateUrl: './clients.page.html',
  styleUrls: ['./clients.page.scss'],
  standalone: false
})
export class ClientsPage implements OnInit {
  clients: ClientRecord[] = [];
  filtered: ClientRecord[] = [];
  search = '';
  loading = true;
  saving = false;
  isEditorOpen = false;
  editingId?: string;
  form: ClientForm = emptyClient();

  constructor(
    public readonly auth: AuthService,
    private readonly service: ClientsService,
    private readonly toastController: ToastController
  ) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try { this.clients = await this.service.list(); this.filter(); }
    catch (error) { await this.toast(this.message(error)); }
    finally { this.loading = false; }
  }

  filter(): void {
    const term = this.search.trim().toLocaleLowerCase('pt-BR');
    this.filtered = this.clients.filter(client =>
      [client.name, client.document, client.email, client.phone, client.contact]
        .some(value => (value ?? '').toLocaleLowerCase('pt-BR').includes(term))
    );
  }

  openNew(): void { this.editingId = undefined; this.form = emptyClient(); this.isEditorOpen = true; }
  openEdit(client: ClientRecord): void {
    this.editingId = client.id;
    this.form = {
      name: client.name ?? '', document: client.document ?? '', email: client.email ?? '',
      phone: client.phone ?? '', contact: client.contact ?? '', address: client.address ?? '',
      notes: client.notes ?? '', active: client.active !== false
    };
    this.isEditorOpen = true;
  }
  closeEditor(): void { this.isEditorOpen = false; }

  async save(): Promise<void> {
    if (!this.form.name.trim()) { await this.toast('Informe o nome do cliente.'); return; }
    this.saving = true;
    try {
      await this.service.save({ ...this.form, name: this.form.name.trim() }, this.editingId);
      this.isEditorOpen = false;
      await this.load();
      await this.toast(this.editingId ? 'Cliente atualizado.' : 'Cliente cadastrado.');
    } catch (error) { await this.toast(this.message(error)); }
    finally { this.saving = false; }
  }

  async remove(client: ClientRecord): Promise<void> {
    if (!client.id || !window.confirm(`Deseja excluir o cliente "${client.name}"?`)) return;
    try { await this.service.remove(client.id); await this.load(); await this.toast('Cliente excluído.'); }
    catch (error) { await this.toast(this.message(error)); }
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2800, position: 'bottom' });
    await toast.present();
  }
  private message(error: unknown): string { return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'; }
}
