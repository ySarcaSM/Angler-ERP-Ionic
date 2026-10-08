import { Injectable } from '@angular/core';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp,
  updateDoc, where
} from 'firebase/firestore';
import { firestore } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { ClientRecord } from '../models/erp.models';

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly collectionName = 'clients';
  constructor(private readonly auth: AuthService) {}

  async list(): Promise<ClientRecord[]> {
    const companyId = this.requireCompany();
    const q = query(collection(firestore, this.collectionName), where('companyId', '==', companyId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ClientRecord))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async save(input: Omit<ClientRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>, id?: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canWrite()) throw new Error('Você não tem permissão para editar clientes.');
    const payload = { ...input, companyId, updatedAt: serverTimestamp() };
    if (id) {
      const ref = doc(firestore, this.collectionName, id);
      const current = await getDoc(ref);
      if (!current.exists() || current.data()['companyId'] !== companyId) {
        throw new Error('Cliente não encontrado nesta empresa.');
      }
      await updateDoc(ref, payload);
    } else {
      await addDoc(collection(firestore, this.collectionName), { ...payload, createdAt: serverTimestamp() });
    }
  }

  async remove(id: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canDelete()) throw new Error('Somente proprietários e administradores podem excluir clientes.');
    const ref = doc(firestore, this.collectionName, id);
    const current = await getDoc(ref);
    if (!current.exists() || current.data()['companyId'] !== companyId) {
      throw new Error('Cliente não encontrado nesta empresa.');
    }
    await deleteDoc(ref);
  }

  private requireCompany(): string {
    const companyId = this.auth.companyId;
    if (!companyId) throw new Error('Sua sessão não possui uma empresa ativa.');
    return companyId;
  }
}
