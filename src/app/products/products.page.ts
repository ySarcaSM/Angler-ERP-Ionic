import { Component, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { AuthService } from '../core/auth.service';
import { ProductRecord } from '../models/erp.models';
import { ProductsService } from '../services/products.service';

type ProductForm = Omit<ProductRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>;
const emptyProduct = (): ProductForm => ({
  name: '', description: '', costPrice: 0, sellPrice: 0,
  stock: { current: 0, minimum: 0, maximum: 0, location: '' }, active: true
});

@Component({
  selector: 'app-products',
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
  standalone: false
})
export class ProductsPage implements OnInit {
  products: ProductRecord[] = [];
  filtered: ProductRecord[] = [];
  search = '';
  loading = true;
  saving = false;
  isEditorOpen = false;
  editingId?: string;
  form: ProductForm = emptyProduct();

  constructor(
    public readonly auth: AuthService,
    private readonly service: ProductsService,
    private readonly toastController: ToastController
  ) {}

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try { this.products = await this.service.list(); this.filter(); }
    catch (error) { await this.toast(this.message(error)); }
    finally { this.loading = false; }
  }

  filter(): void {
    const term = this.search.trim().toLocaleLowerCase('pt-BR');
    this.filtered = this.products.filter(product =>
      [product.name, product.description, product.stock?.location]
        .some(value => (value ?? '').toLocaleLowerCase('pt-BR').includes(term))
    );
  }

  openNew(): void { this.editingId = undefined; this.form = emptyProduct(); this.isEditorOpen = true; }
  openEdit(product: ProductRecord): void {
    this.editingId = product.id;
    this.form = {
      name: product.name ?? '', description: product.description ?? '',
      costPrice: Number(product.costPrice ?? 0), sellPrice: Number(product.sellPrice ?? 0),
      stock: {
        current: Number(product.stock?.current ?? 0), minimum: Number(product.stock?.minimum ?? 0),
        maximum: Number(product.stock?.maximum ?? 0), location: product.stock?.location ?? ''
      },
      active: product.active !== false
    };
    this.isEditorOpen = true;
  }

  async save(): Promise<void> {
    if (!this.form.name.trim()) { await this.toast('Informe o nome do produto.'); return; }
    if (this.form.costPrice < 0 || this.form.sellPrice < 0 || this.form.stock.current < 0 ||
        this.form.stock.minimum < 0 || this.form.stock.maximum < 0) {
      await this.toast('Preços e quantidades não podem ser negativos.'); return;
    }
    this.saving = true;
    try {
      await this.service.save({ ...this.form, name: this.form.name.trim() }, this.editingId);
      this.isEditorOpen = false;
      await this.load();
      await this.toast(this.editingId ? 'Produto atualizado.' : 'Produto cadastrado.');
    } catch (error) { await this.toast(this.message(error)); }
    finally { this.saving = false; }
  }

  async remove(product: ProductRecord): Promise<void> {
    if (!product.id || !window.confirm(`Deseja excluir o produto "${product.name}"?`)) return;
    try { await this.service.remove(product.id); await this.load(); await this.toast('Produto excluído.'); }
    catch (error) { await this.toast(this.message(error)); }
  }

  money(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
  }
  private async toast(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2800, position: 'bottom' });
    await toast.present();
  }
  private message(error: unknown): string { return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'; }
}
