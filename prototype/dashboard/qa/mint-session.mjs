/**
 * Mint a NextAuth session cookie for a local capture session.
 *
 * The dashboard is behind OAuth. To look at the real page with real data we do
 * not need to drive Google — we mint the same artefacts the OAuth callback would
 * produce:
 *
 *   1. a backend JWT (`python fittrack.py exec backend ... create_access_token`)
 *   2. a NextAuth JWT session cookie that carries it as `backendToken`
 *
 * Both are signed with the same secrets the dev server already has, so the page
 * behaves exactly as it does for the signed-in user. Nothing is written to the
 * database and this script is read-only.
 *
 * Usage (from frontend/, because it resolves next-auth from there):
 *   BACKEND_TOKEN=<jwt> node ../prototype/dashboard/qa/mint-session.mjs
 * Prints the cookie value on stdout.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '../../../frontend');
const require = createRequire(path.join(FRONTEND, 'package.json'));

// Load .env.local without pulling in a dotenv dependency.
const envFile = path.join(FRONTEND, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) throw new Error('NEXTAUTH_SECRET missing (checked frontend/.env.local)');

const backendToken = process.env.BACKEND_TOKEN;
if (!backendToken) throw new Error('BACKEND_TOKEN missing — mint one with mint-backend-token.ps1');

const { encode } = require('next-auth/jwt');

const jwt = await encode({
  secret,
  maxAge: 30 * 24 * 60 * 60,
  token: {
    sub: process.env.FITTRACK_USER_ID || '6ad6480b-daad-41b1-8166-b9d8bd2559ab',
    email: process.env.FITTRACK_USER_EMAIL || 'o.radlett@gmail.com',
    name: 'Oli Radlett',
    picture: null,
    backendToken,
    authProvider: 'google',
    authProviderId: 'local-capture',
    backendSyncFailed: false,
  },
});

process.stdout.write(jwt);
