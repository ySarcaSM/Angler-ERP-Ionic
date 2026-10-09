import { inject, Injectable } from '@angular/core';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp,
  updateDoc, where
} from 'firebase/firestore';
import { getFirestoreDb } from '../core/firebase';
import { AuthService } from '../core/auth.service';
import { ClientRecord } from '../models/erp.models';

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly collectionName = 'clients';
  private readonly auth = inject(AuthService);

  async list(): Promise<ClientRecord[]> {
    const companyId = this.requireCompany();
    this.requireRead();
    const q = query(collection(getFirestoreDb(), this.collectionName), where('companyId', '==', companyId));
    const snapshot = await getDocs(q);

    return snapshot.docs
      .map(item => {
        const data = item.data();
        return {
          ...data,
          id: item.id,
          companyId,
          name: this.stringValue(data['name']),
          document: this.stringValue(data['document']),
          email: this.stringValue(data['email']),
          phone: this.stringValue(data['phone']),
          contact: this.stringValue(data['contact']),
          address: this.stringValue(data['address']),
          notes: this.stringValue(data['notes']),
          active: data['active'] !== false
        } as ClientRecord;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async save(input: Omit<ClientRecord, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>, id?: string): Promise<void> {
    const companyId = this.requireCompany();
    if (!this.auth.canWriteCollection(this.collectionName)) {
      throw new Error('Você não tem permissão para editar clientes.');
    }

    const payload = { ...input, companyId, updatedAt: serverTimestamp() };

    if (id) {
      const ref = doc(getFirestoreDb(), this.collectionName, id);
      const current = await getDoc(ref);
      if (!current.exists() || current.data()['companyId'] !== companyId) {
        throw new Error('Cliente não encontrado nesta empresa.');
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
      throw new Error('Somente proprietários e administradores podem excluir clientes.');
    }

    const ref = doc(getFirestoreDb(), this.collectionName, id);
    const current = await getDoc(ref);
    if (!current.exists() || current.data()['companyId'] !== companyId) {
      throw new Error('Cliente não encontrado nesta empresa.');
    }
    await deleteDoc(ref);
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private requireRead(): void {
    if (!this.auth.canReadCollection(this.collectionName)) {
      throw new Error('Seu grupo de operador não possui acesso ao módulo de clientes.');
    }
  }

  private requireCompany(): string {
    const companyId = this.auth.companyId;
    if (!companyId) throw new Error('Sua sessão não possui uma empresa ativa.');
    return companyId;
  }
}