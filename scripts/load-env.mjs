import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
let fileKey = '';

try {
  const contents = await readFile(envPath, 'utf8');
  const line = contents.split(/\r?\n/).find(value => /^\s*GEMINI_API_KEY\s*=/.test(value));
  if (line) fileKey = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '');
} catch {
  // CI can inject a placeholder. Local builds require a .env copied from .env.example.
}

const apiKey = process.env.GEMINI_API_KEY || fileKey;
if (!apiKey && process.env.CI !== 'true') {
  throw new Error('GEMINI_API_KEY ausente. Copie .env.example para .env e configure sua chave.');
}
const output = path.join(root, 'src/app/core/gemini-key.generated.ts');
await writeFile(output, `export const GEMINI_API_KEY = ${JSON.stringify(apiKey || 'CI_NO_API_KEY')};\n`, 'utf8');
