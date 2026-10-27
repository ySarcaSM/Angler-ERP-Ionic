const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { generateWithBestModel } = require('./gemini');

admin.initializeApp();
const geminiApiKey = defineSecret('GEMINI_API_KEY');

function getApiKey() {
  const key = process.env.GEMINI_API_KEY || geminiApiKey.value();
  if (!key || key === 'PASTE_YOUR_GEMINI_API_KEY_HERE') {
    throw new HttpsError('failed-precondition', 'Configure GEMINI_API_KEY no ambiente local ou nos Secrets do Firebase.');
  }
  return key;
}

async function requireActiveCompanyUser(uid) {
  const snapshot = await admin.firestore().doc('users/' + uid).get();
  if (!snapshot.exists) throw new HttpsError('permission-denied', 'Perfil de usuário não encontrado.');
  const profile = snapshot.data();
  if (profile.active === false || profile.status === 'disabled') {
    throw new HttpsError('permission-denied', 'Esta conta está desativada.');
  }
  const activeMembership = Object.values(profile.memberships || {}).some(membership =>
    membership && typeof membership === 'object' && membership.active === true
  );
  const hasCompany = typeof profile.companyId === 'string' ||
    typeof profile.personalCompanyId === 'string' || activeMembership;
  if (!hasCompany) throw new HttpsError('permission-denied', 'A conta não possui vínculo ativo com uma empresa.');
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 18) {
    throw new HttpsError('invalid-argument', 'A conversa deve conter de 1 a 18 mensagens.');
  }
  const allowedRoles = new Set(['system', 'user', 'assistant']);
  let totalLength = 0;
  const normalized = messages.map(message => {
    if (!message || !allowedRoles.has(message.role) || typeof message.content !== 'string') {
      throw new HttpsError('invalid-argument', 'Formato de mensagem inválido.');
    }
    totalLength += message.content.length;
    if (message.content.length > 50000) {
      throw new HttpsError('invalid-argument', 'Uma mensagem excede o limite permitido.');
    }
    return { role: message.role, content: message.content };
  });
  if (totalLength > 100000) throw new HttpsError('invalid-argument', 'A conversa excede o limite de contexto permitido.');
  if (!normalized.some(message => message.role === 'user')) {
    throw new HttpsError('invalid-argument', 'Inclua pelo menos uma mensagem do usuário.');
  }
  return normalized;
}

const isFunctionsEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
const callableOptions = {
  ...(isFunctionsEmulator ? {} : { secrets: [geminiApiKey] }),
  timeoutSeconds: 120,
  memory: '512MiB'
};

exports.geminiAssistant = onCall(
  callableOptions,
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Entre no Angler ERP antes de usar o assistente.');
    try {
      await requireActiveCompanyUser(request.auth.uid);
      const apiKey = getApiKey();
      const action = request.data && request.data.action;
      const messages = action === 'test'
        ? [{ role: 'user', content: 'Responda apenas: OK.' }]
        : action === 'generate' ? validateMessages(request.data.messages) : null;
      if (!messages) throw new HttpsError('invalid-argument', 'Ação do assistente inválida.');
      return await generateWithBestModel(apiKey, messages);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('Falha na integração Gemini:', error.message);
      throw new HttpsError('unavailable', error.message || 'Não foi possível consultar a API Gemini.');
    }
  }
);
