import { Injectable } from '@angular/core';
import { GEMINI_API_KEY } from './gemini-key.generated';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
export const FREE_GEMINI_MODEL_PRIORITY = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
] as const;

export interface GeminiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GeminiResult {
  text: string;
  modelId: string;
}

export function selectFreeGeminiModels(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  const available = new Set(models
    .filter((model): model is { name?: string; supportedGenerationMethods?: unknown } =>
      !!model && typeof model === 'object')
    .filter(model => Array.isArray(model.supportedGenerationMethods) &&
      model.supportedGenerationMethods.includes('generateContent'))
    .map(model => String(model.name ?? '').replace(/^models\//, '')));
  return FREE_GEMINI_MODEL_PRIORITY.filter(model => available.has(model));
}

@Injectable({ providedIn: 'root' })
export class GeminiAiService {
  async test(): Promise<GeminiResult> {
    return this.generate([{ role: 'user', content: 'Responda somente: API funcionando.' }]);
  }

  async generate(messages: GeminiMessage[]): Promise<GeminiResult> {
    const key = GEMINI_API_KEY.trim();
    if (!key || key.startsWith('COLE_')) {
      throw new Error('Defina GEMINI_API_KEY no arquivo .env e reinicie o app.');
    }
    const available = await this.fetchAvailableModels(key);
    const candidates = selectFreeGeminiModels(available);
    if (!candidates.length) {
      throw new Error('A chave não disponibiliza nenhum modelo Gemini da faixa gratuita.');
    }

    let lastError: unknown;
    for (const modelId of candidates.slice(0, 4)) {
      try {
        return { text: await this.callModel(key, modelId, messages), modelId };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Não foi possível executar um modelo Gemini gratuito disponível.');
  }

  private async fetchAvailableModels(key: string): Promise<unknown[]> {
    const response = await fetch(`${GEMINI_API}/models`, {
      headers: { 'x-goog-api-key': key }
    });
    const data = await this.readJson(response);
    return data.models ?? [];
  }

  private async callModel(key: string, modelId: string, messages: GeminiMessage[]): Promise<string> {
    const system = messages.find(message => message.role === 'system');
    const contents = messages.filter(message => message.role !== 'system').map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));
    const response = await fetch(`${GEMINI_API}/models/${encodeURIComponent(modelId)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
        contents,
        generationConfig: { maxOutputTokens: 2048 }
      })
    });
    const data = await this.readJson(response);
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? '').join('\n');
    if (!text) throw new Error('O Gemini não retornou uma resposta de texto.');
    return text;
  }

  private async readJson(response: Response): Promise<any> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message ?? `Erro HTTP ${response.status}: ${response.statusText}`);
    }
    return data;
  }
}
