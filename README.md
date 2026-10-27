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
7. Set up the Gemini backend (steps below) and run `npm start`.

Example user profile (create through Firebase Console or a trusted administrative environment):

```json
{
  "companyId": "company-id",
  "role": "owner"
}
```

## Gemini Assistant

The Ionic assistant uses only Google Gemini. The API key never enters the browser bundle: local development reads it from `functions/.env`, while production reads it from Firebase Secret Manager. The backend lists the models available to the key, tests candidates in priority order, and falls back if a model is unavailable.

### Local development

1. Copy `functions/.env.example` to `functions/.env` and set `GEMINI_API_KEY` to a Gemini API key from Google AI Studio. Do not commit `functions/.env`.
2. Start the Functions emulator in one terminal: `firebase emulators:start --only functions --project YOUR_FIREBASE_PROJECT_ID`.
3. Start Ionic in another terminal: `npm start`.

### Production deployment

1. Select the same Firebase project used by the Ionic app. Cloud Functions deployment requires a Firebase project with billing enabled.
2. Set the key through Firebase Secret Manager: `firebase functions:secrets:set GEMINI_API_KEY --project YOUR_FIREBASE_PROJECT_ID`. Enter the key at the CLI prompt; do not put it in the command or repository.
3. Deploy only the function from this repository: `firebase deploy --only functions --project YOUR_FIREBASE_PROJECT_ID`.

The callable function requires Firebase Authentication and an active user profile. The frontend sends only the chat prompt and context; it never receives the Gemini key.

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
