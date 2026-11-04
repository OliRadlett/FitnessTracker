// Mint a NextAuth session cookie for local QA, so Playwright can open the
// authenticated app without driving Google/GitHub OAuth.
//
// Writes { name, value } to the path in argv[1]. Reads NEXTAUTH_SECRET from the
// repo `.env`, and the backend JWT from argv[2] (see qa/mint-token.py). Neither
// secret is printed.
//
// Run from `frontend/` (so `next-auth` resolves):
//   node ../prototype/relive/qa/mint-session.mjs ../.tmp/qa-session.json ../.tmp/qa-token.txt

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved against the frontend package (the cwd), not this file's location.
const require = createRequire(resolve(process.cwd(), 'package.json'));
const { encode } = require('next-auth/jwt');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');

const outPath = resolve(process.cwd(), process.argv[2] ?? '../.tmp/qa-session.json');
const tokenPath = resolve(process.cwd(), process.argv[3] ?? '../.tmp/qa-token.txt');

function readEnv(key) {
  const env = readFileSync(resolve(repo, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [name, ...rest] = trimmed.split('=');
    if (name.trim() === key) {
      return rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

const secret = process.env.NEXTAUTH_SECRET ?? readEnv('NEXTAUTH_SECRET');
if (!secret) throw new Error('NEXTAUTH_SECRET not found');
const backendToken = readFileSync(tokenPath, 'utf8').trim();
if (!backendToken) throw new Error(`empty backend token at ${tokenPath}`);

const session = await encode({
  secret,
  maxAge: 30 * 24 * 60 * 60,
  token: {
    sub: 'qa-local',
    name: 'Oli Radlett',
    email: 'o.radlett@gmail.com',
    authProvider: 'google',
    authProviderId: 'qa-local',
    backendToken,
  },
});

writeFileSync(
  outPath,
  JSON.stringify({ name: 'next-auth.session-token', value: session }, null, 2),
  'utf8',
);
console.log(`wrote session cookie → ${outPath}`);
