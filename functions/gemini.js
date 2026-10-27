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

function orderModels(models) {
  const eligible = (models || []).filter(model => {
    const id = String(model.name || '').replace(/^models\\//, '');
    const methods = model.supportedGenerationMethods || [];
    return id.startsWith('gemini-') &&
      methods.includes('generateContent') &&
      !EXCLUDED_MODEL_PARTS.some(part => id.toLowerCase().includes(part));
  });
  const priority = new Map(PREFERRED_MODELS.map((name, index) => [name, index]));
  return eligible.sort((a, b) => {
    const idA = String(a.name).replace(/^models\\//, '');
    const idB = String(b.name).replace(/^models\\//, '');
    const rankA = priority.has(idA) ? priority.get(idA) : PREFERRED_MODELS.length;
    const rankB = priority.has(idB) ? priority.get(idB) : PREFERRED_MODELS.length;
    return rankA - rankB || idA.localeCompare(idB);
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

async function generateWithModel(apiKey, modelId, messages, fetchImpl = fetch) {
  const system = messages.find(message => message.role === 'system');
  const contents = messages.filter(message => message.role !== 'system').map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));
  const response = await fetchImpl(API_BASE + '/models/' + encodeURIComponent(modelId) + ':generateContent', {
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
    data.candidates[0].content.parts || []).map(part => part.text || '').join('\\n');
  if (!text) throw new Error('O Gemini não retornou uma resposta de texto.');
  return text;
}

async function generateWithBestModel(apiKey, messages, fetchImpl = fetch) {
  const models = await listModels(apiKey, fetchImpl);
  if (!models.length) throw new Error('A chave Gemini não tem nenhum modelo compatível com generateContent.');
  let lastError;
  for (const model of models) {
    const modelId = String(model.name).replace(/^models\\//, '');
    try {
      return { text: await generateWithModel(apiKey, modelId, messages, fetchImpl), modelId };
    } catch (error) {
      lastError = error;
      // O endpoint de modelos pode anunciar um modelo cuja cota ou acesso ainda não está disponível.
    }
  }
  throw lastError || new Error('Nenhum modelo Gemini pôde ser executado.');
}

module.exports = { orderModels, listModels, generateWithModel, generateWithBestModel };
