import { Injectable } from '@angular/core';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFunctions } from './firebase';

export interface GeminiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GeminiResult {
  text: string;
  modelId: string;
}

@Injectable({ providedIn: 'root' })
export class GeminiAiService {
  async test(): Promise<GeminiResult> {
    return this.call({ action: 'test' });
  }

  async generate(messages: GeminiMessage[]): Promise<GeminiResult> {
    return this.call({ action: 'generate', messages });
  }

  private async call(payload: { action: 'test' | 'generate'; messages?: GeminiMessage[] }): Promise<GeminiResult> {
    const callable = httpsCallable<typeof payload, GeminiResult>(getFirebaseFunctions(), 'geminiAssistant');
    const result = await callable(payload);
    return result.data;
  }
}
