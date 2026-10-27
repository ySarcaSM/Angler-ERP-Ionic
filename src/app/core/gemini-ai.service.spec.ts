import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiAiService } from './gemini-ai.service';

function streamResponse(text: string): Response {
  const chunks = text.match(/.{1,5}/g) ?? [text];
  const body = chunks.map(chunk => `data: ${JSON.stringify({
    candidates: [{ content: { parts: [{ text: chunk }] } }]
  })}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

describe('GeminiAiService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses streamed responses and reuses the first working free model', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/gemini-3.8-flash:')) {
        return new Response(JSON.stringify({ error: { message: 'unavailable' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return streamResponse('Resposta rápida');
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiAiService();
    const received: string[] = [];

    const first = await service.generate([{ role: 'user', content: 'Oi' }], text => received.push(text));
    const second = await service.generate([{ role: 'user', content: 'Tudo bem?' }]);

    expect(first).toBe('Resposta rápida');
    expect(second).toBe('Resposta rápida');
    expect(received.length).toBeGreaterThan(1);
    expect(urls.every(url => url.includes(':streamGenerateContent?alt=sse'))).toBe(true);
    expect(urls.some(url => url.includes('/models?'))).toBe(false);
    expect(urls[1]).toContain('gemini-3.6-flash');
    expect(urls[2]).toContain('gemini-3.6-flash');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
