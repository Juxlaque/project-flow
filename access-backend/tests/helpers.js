import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { AccessPolicy } from '../src/access.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { TokenService } from '../src/tokens.js';

// ATTENTION : ce fichier ne contient VOLONTAIREMENT que des valeurs inventées.
// Les vraies valeurs Discord vivent uniquement dans .env (gitignoré) et dans
// les variables d'environnement de Render. Ne les colle JAMAIS ici : ce fichier
// part sur GitHub, et GitHub bloque (à raison) tout push contenant un token.
const repeat = (character, length) => character.repeat(length);

export const GUILD_ID = '111111111111111111';
export const ROLE_ID = '222222222222222222';

const env = {
  NODE_ENV: 'test',
  DISCORD_CLIENT_ID: '333333333333333333',
  DISCORD_CLIENT_SECRET: repeat('c', 32),
  DISCORD_BOT_TOKEN: repeat('b', 32),
  DISCORD_GUILD_ID: GUILD_ID,
  DISCORD_ACCESS_ROLE_ID: ROLE_ID,
  AUTH_JWT_SECRET: repeat('j', 48),
  ADMIN_SECRET: 'admin-secret-value-for-tests',
  PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
  ALLOWED_REDIRECTS: 'rebootlauncher://auth',
  MAX_DEVICES: '2',
};

export const testEnv = env;

export class FakeDiscord {
  constructor() {
    this.members = new Map();
    this.down = false;
    this.user = { id: '111111111111111111', username: 'cheater', globalName: 'Cheater', avatar: null };
  }

  invite(userId, roles = [ROLE_ID]) {
    this.members.set(userId, { userId, roles, nick: null, joinedAt: null });
  }

  kick(userId) {
    this.members.delete(userId);
  }

  authorizeUrl({ redirectUri, state }) {
    const params = new URLSearchParams({ redirect_uri: redirectUri, state, client_id: 'fake' });
    return `https://discord.test/oauth2/authorize?${params.toString()}`;
  }

  async exchangeCode({ code }) {
    if (code !== 'valid-code') {
      throw new Error('invalid grant');
    }
    return { access_token: 'user-access-token' };
  }

  async fetchUser() {
    return this.user;
  }

  async fetchMember(userId) {
    if (this.down) {
      throw new Error('Discord indisponible');
    }
    return this.members.get(userId) ?? null;
  }
}

export async function startApi(overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'access-backend-'));
  const config = loadConfig({ ...env, DATA_DIR: directory, ...overrides });
  const store = await Store.open(path.join(directory, 'access.json'));
  const tokens = new TokenService({
    secret: config.jwtSecret,
    issuer: config.issuer,
    audience: config.audience,
    accessTtlSeconds: config.accessTtlSeconds,
    refreshTtlSeconds: config.refreshTtlSeconds,
    stateTtlSeconds: config.stateTtlSeconds,
  });
  const discord = new FakeDiscord();
  const access = new AccessPolicy({ discord, store, config });
  const app = createApp({ config, store, tokens, discord, access });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    baseUrl,
    config,
    store,
    tokens,
    discord,
    directory,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Walks the browser flow and returns the one-time code for /auth/exchange. */
export async function loginCodeFor(api, redirect = 'rebootlauncher://auth') {
  const start = await fetch(`${api.baseUrl}/auth/discord?redirect=${encodeURIComponent(redirect)}`, { redirect: 'manual' });
  const authorize = new URL(start.headers.get('location'));
  const state = authorize.searchParams.get('state');

  const callback = await fetch(
    `${api.baseUrl}/auth/callback?code=valid-code&state=${encodeURIComponent(state)}`,
    { redirect: 'manual' },
  );

  const location = callback.headers.get('location');
  return { status: callback.status, location, code: location ? new URL(location).searchParams.get('code') : null };
}

export function decode(token, secret = env.AUTH_JWT_SECRET) {
  return jwt.decode(token, { json: true, secret });
}
