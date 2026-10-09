import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/lazy';
import { AuthService } from '../core/auth.service';

type AccessoryType = 'cord' | 'handle';

interface CutPlan {
  width: number;
  usableLength: number;
  piecesPerRow: number;
  rows: number;
  capacity: number;
  lengthLeftover: number;
  widthLeftover: number;
  pieceWidth: number;
  pieceHeight: number;
  groupLength: number;
  accordionWidth: number;
  rotated: boolean;
}

interface MeasurementForm {
  height: number;
  width: number;
  length: number;
  accordionWidth: number;
  quantity: number;
  materialWidth: number;
  waste: number;
  accessoryType: AccessoryType;
  handleQuantity: number;
  cordQuantity: number;
}

interface BudgetForm {
  materialCostPerMeter: number;
  accessoryCostPerMeter: number;
  laborCostPerUnit: number;
  unitPrice: number;
}

@Component({
  selector: 'app-orcamentos',
  templateUrl: './orcamentos.page.html',
  styleUrls: ['./orcamentos.page.scss'],
  standalone: false
})
export class OrcamentosPage {
  private readonly toastController = inject(ToastController);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly auth = inject(AuthService);

  form: MeasurementForm = {
    height: 30,
    width: 25,
    length: 10,
    accordionWidth: 0,
    quantity: 100,
    materialWidth: 150,
    waste: 10,
    accessoryType: 'cord',
    handleQuantity: 2,
    cordQuantity: 1
  };

  budget: BudgetForm = {
    materialCostPerMeter: 0,
    accessoryCostPerMeter: 0,
    laborCostPerUnit: 0,
    unitPrice: 0
  };

  budgetOpen = false;
  savingBudget = false;

  get quantity(): number { return Math.max(0, Math.floor(this.number(this.form.quantity))); }
  get materialWidth(): number { return Math.max(1, this.number(this.form.materialWidth)); }
  get accordionWidth(): number { return Math.max(0, this.number(this.form.accordionWidth)); }
  get wasteFactor(): number { return 1 + Math.max(0, this.number(this.form.waste)) / 100; }

  get previewRows(): number[] { return Array.from({ length: Math.min(12, this.tablePlan.rows) }, (_, index) => index); }
  get previewColumns(): number[] { return Array.from({ length: Math.min(18, this.tablePlan.piecesPerRow) }, (_, index) => index); }

  get tablePlan(): CutPlan {
    const usableLength = 262;
    const usableWidth = Math.min(this.materialWidth, 150);
    const width = this.number(this.form.width);
    const height = this.number(this.form.height);
    const accordion = this.accordionWidth;
    const options = [
      { pieceWidth: width, pieceHeight: height, rotated: false },
      ...(accordion > 0 ? [] : [{ pieceWidth: height, pieceHeight: width, rotated: true }])
    ].filter(option =>
      option.pieceWidth > 0 &&
      option.pieceHeight > 0 &&
      option.pieceWidth + (2 * accordion) <= usableLength &&
      option.pieceHeight <= usableWidth
    );

    const plans = options.map(option => {
      const groupLength = option.pieceWidth + (2 * accordion);
      const piecesPerRow = Math.floor(usableLength / groupLength);
      const rows = Math.floor(usableWidth / option.pieceHeight);
      return {
        width: usableWidth,
        usableLength,
        piecesPerRow,
        rows,
        capacity: piecesPerRow * rows,
        lengthLeftover: usableLength - piecesPerRow * groupLength,
        widthLeftover: usableWidth - rows * option.pieceHeight,
        pieceWidth: option.pieceWidth,
        pieceHeight: option.pieceHeight,
        groupLength,
        accordionWidth: accordion,
        rotated: option.rotated
      };
    });

    return plans.reduce((best, plan) => {
      if (!best || plan.capacity > best.capacity) return plan;
      if (plan.capacity === best.capacity &&
          plan.lengthLeftover + plan.widthLeftover < best.lengthLeftover + best.widthLeftover) return plan;
      return best;
    }, null as CutPlan | null) || {
      width: usableWidth, usableLength, piecesPerRow: 0, rows: 0, capacity: 0,
      lengthLeftover: usableLength, widthLeftover: usableWidth,
      pieceWidth: width, pieceHeight: height, groupLength: width + 2 * accordion,
      accordionWidth: accordion, rotated: false
    };
  }

  get materialPlans(): CutPlan[] {
    const plans: CutPlan[] = [];
    let remaining = this.materialWidth;
    while (remaining > 0) {
      const segment = Math.min(150, remaining);
      const plan = this.createPlan(segment);
      if (plan.capacity > 0) plans.push(plan);
      remaining -= segment;
    }
    return plans;
  }

  private createPlan(segmentWidth: number): CutPlan {
    const usableLength = 262;
    const usableWidth = Math.min(Math.max(0, segmentWidth), 150);
    const width = this.number(this.form.width);
    const height = this.number(this.form.height);
    const accordion = this.accordionWidth;
    const options = [
      { pieceWidth: width, pieceHeight: height, rotated: false },
      ...(accordion > 0 ? [] : [{ pieceWidth: height, pieceHeight: width, rotated: true }])
    ].filter(option => option.pieceWidth > 0 && option.pieceHeight > 0 &&
      option.pieceWidth + 2 * accordion <= usableLength && option.pieceHeight <= usableWidth);
    const plans = options.map(option => {
      const groupLength = option.pieceWidth + 2 * accordion;
      const piecesPerRow = Math.floor(usableLength / groupLength);
      const rows = Math.floor(usableWidth / option.pieceHeight);
      return {
        width: usableWidth, usableLength, piecesPerRow, rows,
        capacity: piecesPerRow * rows,
        lengthLeftover: usableLength - piecesPerRow * groupLength,
        widthLeftover: usableWidth - rows * option.pieceHeight,
        pieceWidth: option.pieceWidth, pieceHeight: option.pieceHeight,
        groupLength, accordionWidth: accordion, rotated: option.rotated
      };
    });
    return plans.reduce((best, plan) => !best || plan.capacity > best.capacity ? plan : best, null as CutPlan | null) ||
      { width: usableWidth, usableLength, piecesPerRow: 0, rows: 0, capacity: 0,
        lengthLeftover: usableLength, widthLeftover: usableWidth, pieceWidth: width,
        pieceHeight: height, groupLength: width + 2 * accordion, accordionWidth: accordion, rotated: false };
  }

  get canCut(): boolean {
    const height = this.number(this.form.height);
    const width = this.number(this.form.width);
    return this.quantity > 0 && this.materialWidth > 0 && height > 0 && width > 0 &&
      (height <= this.materialWidth || width <= this.materialWidth) &&
      (width <= 262 || height <= 262) && this.tablePlan.capacity > 0;
  }

  get quantityWithinCapacity(): boolean {
    return this.quantity <= this.tablePlan.capacity;
  }

  get areaPerUnit(): number {
    const h = this.number(this.form.height);
    const w = this.number(this.form.width);
    const length = this.number(this.form.length);
    return (h * (w + length + 2 * this.accordionWidth) / 10000) * this.wasteFactor;
  }

  get totalArea(): number { return this.areaPerUnit * this.quantity; }
  get linearMaterial(): number { return this.materialPlans.length * 300 * this.wasteFactor; }
  get handleLengthPerUnit(): number { return 35 * (this.number(this.form.height) / 30); }
  get cordLengthPerUnit(): number { return 60 * (this.number(this.form.height) / 30); }
  get totalAccessoryMeters(): number {
    const handles = this.form.accessoryType === 'handle' ? this.handleLengthPerUnit * this.number(this.form.handleQuantity) * this.quantity / 100 : 0;
    const cords = this.form.accessoryType === 'cord' ? this.cordLengthPerUnit * this.number(this.form.cordQuantity) * this.quantity / 100 : 0;
    return handles + cords;
  }

  get budgetResult() {
    const material = this.linearMaterial / 100 * this.number(this.budget.materialCostPerMeter);
    const accessories = this.totalAccessoryMeters * this.number(this.budget.accessoryCostPerMeter);
    const labor = this.quantity * this.number(this.budget.laborCostPerUnit);
    const revenue = this.quantity * this.number(this.budget.unitPrice);
    const productionTotal = material + accessories + labor;
    const productionPerUnit = this.quantity ? productionTotal / this.quantity : 0;
    return {
      material, accessories, labor, revenue, productionTotal, productionPerUnit,
      profitPerUnit: this.number(this.budget.unitPrice) - productionPerUnit,
      profitTotal: revenue - productionTotal
    };
  }

  updateNumber(field: Exclude<keyof MeasurementForm, 'accessoryType'>, value: number | string | null): void {
    (this.form as unknown as Record<string, number | string>)[field] = value === null || value === '' ? '' : Number(value);
    this.changeDetector.markForCheck();
  }

  updateBudget(field: keyof BudgetForm, value: number | string): void {
    this.budget[field] = this.number(value);
    this.changeDetector.markForCheck();
  }

  reset(): void {
    this.form = {
      height: 30, width: 25, length: 10, accordionWidth: 0, quantity: 100,
      materialWidth: 150, waste: 10, accessoryType: 'cord', handleQuantity: 2, cordQuantity: 1
    };
    this.budget = { materialCostPerMeter: 0, accessoryCostPerMeter: 0, laborCostPerUnit: 0, unitPrice: 0 };
  }

  money(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(value) ? value : 0);
  }

  format(value: number, digits = 1): string {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number.isFinite(value) ? value : 0);
  }

  private number(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async notify(message: string): Promise<void> {
    const toast = await this.toastController.create({ message, duration: 2600, position: 'bottom' });
    await toast.present();
  }
}
