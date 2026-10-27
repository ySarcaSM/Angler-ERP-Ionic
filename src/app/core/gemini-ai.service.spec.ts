import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAiService, selectFreeGeminiModels } from './gemini-ai.service';

describe('Gemini free-tier model selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts only supported models from the explicit free-tier allowlist', () => {
    expect(selectFreeGeminiModels([
      { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] }
    ])).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']);
  });

  it('tests the preferred free model and falls back only to another free model', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/models')) {
        return {
          ok: true,
          json: async () => ({ models: [
            { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] }
          ] })
        } as Response;
      }
      if (url.includes('/gemini-3.8-flash:')) {
        return { ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ error: { message: 'unavailable' } }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] })
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new GeminiAiService().test();
    expect(result.modelId).toBe('gemini-3.6-flash');
    expect(urls.some(url => url.includes('gemini-3.1-pro-preview'))).toBe(false);
  });
});
