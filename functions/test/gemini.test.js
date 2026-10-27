const test = require('node:test');
const assert = require('node:assert/strict');
const { orderModels, generateWithBestModel } = require('../gemini');

test('prioritizes the preferred current Gemini generation model and ignores non-text models', () => {
  const models = orderModels([
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-embedding', supportedGenerationMethods: ['embedContent'] }
  ]);
  assert.deepEqual(models.map(model => model.name), [
    'models/gemini-3.8-flash',
    'models/gemini-3.6-flash',
    'models/gemini-2.5-flash'
  ]);
});

test('falls back to the next available model when the preferred model rejects the request', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(url);
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify({ models: [
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }
      ] }), { status: 200 });
    }
    if (url.includes('/gemini-3.8-flash:')) return new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 });
  };
  const result = await generateWithBestModel('secret', [{ role: 'user', content: 'oi' }], fetchImpl);
  assert.equal(result.modelId, 'gemini-3.6-flash');
  assert.equal(result.text, 'OK');
  assert.equal(calls.length, 3);
});
