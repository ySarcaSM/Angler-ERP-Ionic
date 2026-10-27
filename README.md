# Angler ERP Ionic

ERP frontend built with **Ionic + Angular + TypeScript**, using Angular **NgModules** (not standalone components) and Firebase Authentication / Cloud Firestore.

## Requirements

- Node.js supported by the Angular CLI version in `package.json`
- npm
- A Firebase project with Email/Password Authentication and Cloud Firestore enabled

## Setup

1. Run `npm install`.
2. Create a Firebase Web App in Firebase Console.
3. Copy the web app config into `src/environments/environment.ts` and `src/environments/environment.prod.ts` under the `firebase` object.
4. Enable Email/Password in Firebase Authentication.
5. For every authorized user, create a `users/{uid}` document with `companyId` and `role`. Supported roles: `owner`, `admin`, `operator`, `viewer`.
6. Publish `firestore.rules` to the Firestore database.
7. Configure Gemini (steps below) and run `npm start`.

Example user profile (create through Firebase Console or a trusted administrative environment):

```json
{
  "companyId": "company-id",
  "role": "owner"
}
```

## Gemini Assistant (sem serviços pagos)

O assistente usa diretamente a Gemini Developer API pelo app Ionic e limita os modelos a uma lista explícita da faixa gratuita. Não usa Cloud Functions nem exige plano Blaze. Para manter a conta sem cobranças, crie a chave em um projeto sem conta de faturamento vinculada; não habilite a faixa paga. A API gratuita tem limites de uso e pode recusar solicitações ao atingir esses limites.

### Configuração local

1. Copie `.env.example` para `.env` e preencha `GEMINI_API_KEY` com uma chave criada no Google AI Studio.
2. Rode `npm start` ou `npm run build`; os scripts carregam a chave do `.env` durante a compilação.
3. O assistente testa a API ao abrir, tenta primeiro o modelo gratuito prioritário e segue para outros modelos gratuitos compatíveis se ele falhar.

### Chave e privacidade

A chave nunca é salva no Firestore nem no Git, mas é incorporada ao JavaScript compilado e pode ser extraída por qualquer pessoa que tenha acesso ao app publicado. Restrinja a chave à Gemini API e aos domínios do Ionic Web App no Google Cloud Console; não reutilize a chave em outros sistemas.

As mensagens e o contexto de clientes/produtos usados na resposta são enviados à Google. No nível gratuito, os dados podem ser usados para melhorar produtos Google; não envie informações pessoais ou confidenciais. A lista de modelos permitidos evita solicitar modelos pagos, mas a conta da API também precisa permanecer sem faturamento vinculado para garantir que o projeto não entre na faixa paga.

## Routes

- `/login`: Firebase Authentication sign-in.
- `/home`: dashboard and navigation.
- `/clientes`: search, create, edit and delete clients.
- `/produtos`: search, create, edit and delete products.

## Firestore compatibility

Existing collection names are intentionally preserved:

- `clients`: `name`, `document`, `email`, `phone`, `contact`, with optional `address`, `notes`, `active`, `companyId`, timestamps.
- `products`: `name`, `description`, `costPrice`, `sellPrice`, `stock.current`, `stock.minimum`, `stock.maximum`, `stock.location`, `active`, `companyId`, timestamps.

## Security

- Client queries are scoped to the authenticated user's `companyId`.
- Firestore rules independently enforce company isolation and role-based writes/deletes. UI checks are not a security boundary.
- `viewer` can read but not write; only `owner` and `admin` can delete.
- Firebase web config is client configuration, not an Admin SDK secret. Never add service-account credentials to frontend code.
- Rules deny access to collections not explicitly covered; review and add scoped rules before enabling other ERP modules.


## Validation

GitHub Actions validates the production build, lint and unit tests on this branch and pull requests targeting `main`.


<!-- CI trigger: Angular lint fixes -->

<!-- CI trigger: fix malformed newline literals -->

<!-- CI trigger: isolated Firebase test environment -->

<!-- CI trigger: Firebase lazy initialization and test isolation -->

<!-- CI trigger: Firebase environment import fix -->
