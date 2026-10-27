import { Injectable } from '@angular/core';
import { GEMINI_API_KEY } from './gemini-key.generated';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const FREE_MODEL_FALLBACKS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
] as const;

export interface GeminiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable({ providedIn: 'root' })
export class GeminiAiService {
  private selectedModelId: typeof FREE_MODEL_FALLBACKS[number] = FREE_MODEL_FALLBACKS[0];

  async generate(messages: GeminiMessage[], onText?: (text: string) => void): Promise<string> {
    const key = GEMINI_API_KEY.trim();
    if (!key || key.startsWith('COLE_')) {
      throw new Error('Defina GEMINI_API_KEY no arquivo .env e reinicie o app.');
    }

    const orderedModels = [
      this.selectedModelId,
      ...FREE_MODEL_FALLBACKS.filter(model => model !== this.selectedModelId)
    ];
    let lastError: unknown;

    for (const modelId of orderedModels) {
      try {
        onText?.('');
        const answer = await this.streamModel(key, modelId, messages, onText);
        this.selectedModelId = modelId;
        return answer;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Não foi possível concluir a solicitação ao Gemini.');
  }

  private async fetchWithRetry(url: string, options: RequestInit): Promise<Response> {
    const transientStatuses = new Set([429, 500, 502, 503, 504]);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, options);
        if (!transientStatuses.has(response.status) || attempt === 2) return response;
      } catch (error) {
        lastError = error;
        if (attempt === 2) throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }

    throw lastError instanceof Error ? lastError : new Error('O Gemini está temporariamente indisponível.');
  }

  private async streamModel(
    key: string,
    modelId: string,
    messages: GeminiMessage[],
    onText?: (text: string) => void,
    prefix = '',
    continuation = 0
  ): Promise<string> {
    const system = messages.find(message => message.role === 'system');
    const contents = messages.filter(message => message.role !== 'system').map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));
    const response = await this.fetchWithRetry(
      `${GEMINI_API}/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
          contents,
          generationConfig: { maxOutputTokens: 4096 }
        })
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message ?? `Erro HTTP ${response.status}: ${response.statusText}`);
    }
    if (!response.body) throw new Error('O navegador não disponibilizou a resposta em streaming.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let finishReason = '';

    const consumeEvent = (event: string): void => {
      const data = event.split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') return;

      let payload: any;
      try { payload = JSON.parse(data); } catch { return; }
      const candidate = payload.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      const chunk = (candidate?.content?.parts ?? [])
        .map((part: { text?: string }) => part.text ?? '')
        .join('');
      if (!chunk) return;
      answer += chunk;
      onText?.(prefix + answer);
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        events.forEach(consumeEvent);
        if (done) break;
      }
      if (buffer.trim()) consumeEvent(buffer);
    } finally {
      reader.releaseLock();
    }

    if (!answer) throw new Error('O Gemini não retornou uma resposta de texto.');

    const completeAnswer = prefix + answer;
    if (finishReason === 'MAX_TOKENS') {
      if (continuation < 2) {
        const continuationMessages: GeminiMessage[] = [
          ...messages,
          { role: 'assistant', content: answer },
          { role: 'user', content: 'Continue exatamente do ponto em que a resposta foi interrompida. Não repita o conteúdo anterior e conclua a resposta.' }
        ];
        return this.streamModel(key, modelId, continuationMessages, onText, completeAnswer, continuation + 1);
      }
      const notice = '\n\n[Resposta interrompida ao atingir o limite de geração. Peça “continue” para prosseguir.]';
      onText?.(completeAnswer + notice);
      return completeAnswer + notice;
    }
    return completeAnswer;
  }
}
