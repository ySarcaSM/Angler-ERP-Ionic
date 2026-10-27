const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PREFERRED_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite'
];
const EXCLUDED_MODEL_PARTS = ['image', 'audio', 'tts', 'live', 'embedding', 'robotics', 'aqa'];

function modelId(model) {
  return String(model.name || '').replace(/^models\//, '');
}

function orderModels(models) {
  const eligible = (models || []).filter(model => {
    const id = modelId(model);
    const methods = model.supportedGenerationMethods || [];
    return id.startsWith('gemini-') &&
      methods.includes('generateContent') &&
      !EXCLUDED_MODEL_PARTS.some(part => id.toLowerCase().includes(part));
  });
  const priority = new Map(PREFERRED_MODELS.map((name, index) => [name, index]));
  const version = id => (id.match(/^gemini-(\d+(?:\.\d+)*)/) || [])[1] || '0';
  const compareVersions = (left, right) => {
    const a = version(left).split('.').map(Number);
    const b = version(right).split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const difference = (b[i] || 0) - (a[i] || 0);
      if (difference) return difference;
    }
    return 0;
  };
  const category = id => id.includes('flash-lite') ? 2 : id.includes('-pro') ? 1 : id.includes('-flash') ? 0 : 3;
  return eligible.sort((a, b) => {
    const idA = modelId(a);
    const idB = modelId(b);
    const rankA = priority.has(idA) ? priority.get(idA) : PREFERRED_MODELS.length;
    const rankB = priority.has(idB) ? priority.get(idB) : PREFERRED_MODELS.length;
    return rankA - rankB || category(idA) - category(idB) ||
      compareVersions(idA, idB) || idA.localeCompare(idB);
  });
}

async function readJson(response) {
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* handled as HTTP error below */ }
  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : 'Erro HTTP ' + response.status;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function listModels(apiKey, fetchImpl = fetch) {
  const response = await fetchImpl(API_BASE + '/models', { headers: { 'x-goog-api-key': apiKey } });
  const data = await readJson(response);
  return orderModels(data.models);
}

async function generateWithModel(apiKey, model, messages, fetchImpl = fetch) {
  const system = messages.find(message => message.role === 'system');
  const contents = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));
  const response = await fetchImpl(API_BASE + '/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
    })
  });
  const data = await readJson(response);
  const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts || []).map(part => part.text || '').join('\n');
  if (!text) throw new Error('O Gemini não retornou uma resposta de texto.');
  return text;
}

async function generateWithBestModel(apiKey, messages, fetchImpl = fetch) {
  const models = await listModels(apiKey, fetchImpl);
  if (!models.length) throw new Error('A chave Gemini não tem nenhum modelo compatível com generateContent.');
  let lastError;
  for (const model of models.slice(0, 4)) {
    const id = modelId(model);
    try {
      return { text: await generateWithModel(apiKey, id, messages, fetchImpl), modelId: id };
    } catch (error) {
      lastError = error;
      // O endpoint de modelos pode anunciar um modelo cuja cota ou acesso ainda não está disponível.
    }
  }
  throw lastError || new Error('Nenhum modelo Gemini pôde ser executado.');
}

module.exports = { orderModels, listModels, generateWithModel, generateWithBestModel };
