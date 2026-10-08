import { Injectable } from '@angular/core';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp,
  updateDoc, where
} from 'firebase/firestore';
import { firestore } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { ProductRecord } from '../models/erp.models';

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private readonly collectionName = 'products';
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<ProductRecord[]> {
    const companyId = this.requireCompany();
    const q = query(collection(firestore, this.collectionName), where('companyId', '==', companyId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ProductRecord))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async save(input: Omit<ProductRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>, id?: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canWrite()) throw new Error('Você não tem permissão para editar produtos.');
    const payload = { ...input, companyId, updatedAt: serverTimestamp() };
    if (id) {
      const ref = doc(firestore, this.collectionName, id);
      const current = await getDoc(ref);
      if (!current.exists() || current.data()['companyId'] !== companyId) {
        throw new Error('Produto não encontrado nesta empresa.');
      }
      await updateDoc(ref, payload);
    } else {
      await addDoc(collection(firestore, this.collectionName), { ...payload, createdAt: serverTimestamp() });
    }
  }

  async remove(id: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canDelete()) throw new Error('Somente proprietários e administradores podem excluir produtos.');
    const ref = doc(firestore, this.collectionName, id);
    const current = await getDoc(ref);
    if (!current.exists() || current.data()['companyId'] !== companyId) {
      throw new Error('Produto não encontrado nesta empresa.');
    }
    await deleteDoc(ref);
  }

  private requireCompany(): string {
    const companyId = this.auth.companyId;
    if (!companyId) throw new Error('Sua sessão não possui uma empresa ativa.');
    return companyId;
  }
}
