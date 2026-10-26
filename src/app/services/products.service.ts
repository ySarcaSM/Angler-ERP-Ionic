import { inject, Injectable } from '@angular/core';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp,
  updateDoc, where
} from 'firebase/firestore';
import { getFirestoreDb } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { ProductRecord } from '../models/erp.models';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly collectionName = 'products';
  private readonly auth = inject(AuthService);

  async list(): Promise<ProductRecord[]> {
    const companyId = this.requireCompany();
    this.requireRead();
    const q = query(collection(getFirestoreDb(), this.collectionName), where('companyId', '==', companyId));
    const snapshot = await getDocs(q);

    return snapshot.docs
      .map(item => {
        const data = item.data();
        const rawStock = data['stock'] && typeof data['stock'] === 'object'
          ? data['stock'] as Record<string, unknown>
          : {};

        return {
          ...data,
          id: item.id,
          companyId,
          name: this.stringValue(data['name']),
          description: this.stringValue(data['description']),
          costPrice: this.numberValue(data['costPrice']),
          sellPrice: this.numberValue(data['sellPrice']),
          stock: {
            current: this.numberValue(rawStock['current']),
            minimum: this.numberValue(rawStock['minimum']),
            maximum: this.numberValue(rawStock['maximum']),
            location: this.stringValue(rawStock['location'])
          },
          active: data['active'] !== false
        } as ProductRecord;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async save(input: Omit<ProductRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>, id?: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canWriteCollection(this.collectionName)) {
      throw new Error('Você não tem permissão para editar produtos.');
    }

    const payload = { ...input, companyId, updatedAt: serverTimestamp() };

    if (id) {
      const ref = doc(getFirestoreDb(), this.collectionName, id);
      const current = await getDoc(ref);
      if (!current.exists() || current.data()['companyId'] !== companyId) {
        throw new Error('Produto não encontrado nesta empresa.');
      }
      await updateDoc(ref, payload);
    } else {
      await addDoc(collection(getFirestoreDb(), this.collectionName), {
        ...payload,
        createdAt: serverTimestamp()
      });
    }
  }

  async remove(id: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canDelete()) {
      throw new Error('Somente proprietários e administradores podem excluir produtos.');
    }

    const ref = doc(getFirestoreDb(), this.collectionName, id);
    const current = await getDoc(ref);
    if (!current.exists() || current.data()['companyId'] !== companyId) {
      throw new Error('Produto não encontrado nesta empresa.');
    }
    await deleteDoc(ref);
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private numberValue(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private requireRead(): void {
    if (!this.auth.canReadCollection(this.collectionName)) {
      throw new Error('Seu grupo de operador não possui acesso ao módulo de produtos.');
    }
  }

  private requireCompany(): string {
    const companyId = this.auth.companyId;
    if (!companyId) throw new Error('Sua sessão não possui uma empresa ativa.');
    return companyId;
  }
}