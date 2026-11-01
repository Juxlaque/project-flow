import assert from 'node:assert/strict';
import test from 'node:test';
import { GUILD_ID, ROLE_ID, loginCodeFor, startApi } from './helpers.js';

const USER_ID = '111111111111111111';

async function exchange(api, code, deviceId = 'machine-1') {
  const response = await fetch(`${api.baseUrl}/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, deviceId }),
  });
  return { status: response.status, body: await response.json() };
}

async function fullLogin(api, deviceId = 'machine-1') {
  const { code } = await loginCodeFor(api);
  return exchange(api, code, deviceId);
}

test('un membre avec le bon rôle obtient des tokens utilisables', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const { status, body } = await fullLogin(api);

  assert.equal(status, 200);
  assert.equal(body.tokenType, 'Bearer');
  assert.equal(body.expiresIn, api.config.accessTtlSeconds);
  assert.equal(body.user.id, USER_ID);
  assert.ok(body.accessToken && body.refreshToken);

  const me = await fetch(`${api.baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${body.accessToken}` },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.id, USER_ID);

  const verify = await fetch(`${api.baseUrl}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: body.accessToken }),
  });
  assert.equal(verify.status, 200);
  assert.equal((await verify.json()).session.deviceBound, true);
});

test('le code de connexion est à usage unique', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const { code } = await loginCodeFor(api);
  assert.equal((await exchange(api, code)).status, 200);

  const replay = await exchange(api, code);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'invalid_code');
});

test('un non-membre du serveur Discord est refusé', async (t) => {
  const api = await startApi();
  t.after(() => api.close());

  const { location } = await loginCodeFor(api);
  assert.equal(new URL(location).searchParams.get('error'), 'not_in_guild');
});

test('un membre sans le rôle requis est refusé', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID, ['999999999999999999']);

  const { location } = await loginCodeFor(api);
  assert.equal(new URL(location).searchParams.get('error'), 'missing_role');
});

test('quand Discord est injoignable on refuse (fail closed)', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.down = true;

  const { location } = await loginCodeFor(api);
  assert.equal(new URL(location).searchParams.get('error'), 'discord_unavailable');
});

test('un ban coupe immédiatement les tokens déjà émis', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const { body } = await fullLogin(api);

  const ban = await fetch(`${api.baseUrl}/admin/ban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${api.config.adminSecret}` },
    body: JSON.stringify({ discordId: USER_ID, reason: 'triche' }),
  });
  assert.equal(ban.status, 200);

  const verify = await fetch(`${api.baseUrl}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: body.accessToken }),
  });
  assert.equal(verify.status, 403);
  assert.equal((await verify.json()).error, 'banned');

  const me = await fetch(`${api.baseUrl}/auth/me`, { headers: { authorization: `Bearer ${body.accessToken}` } });
  assert.equal(me.status, 403);

  const relogin = await loginCodeFor(api);
  assert.equal(new URL(relogin.location).searchParams.get('error'), 'banned');

  const unban = await fetch(`${api.baseUrl}/admin/unban`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${api.config.adminSecret}` },
    body: JSON.stringify({ discordId: USER_ID }),
  });
  assert.equal(unban.status, 200);

  api.discord.invite(USER_ID);
  const after = await fullLogin(api, 'machine-1');
  assert.equal(after.status, 200);
});

test('retirer quelqu\'un du serveur Discord révoque son refresh', async (t) => {
  const api = await startApi({ ACCESS_CACHE_TTL_MS: '0' });
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const { body } = await fullLogin(api);
  api.discord.kick(USER_ID);

  const response = await fetch(`${api.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: body.refreshToken }),
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'not_in_guild');
});

test('la limite de machines bloque le surplus', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  assert.equal((await fullLogin(api, 'machine-1')).status, 200);
  assert.equal((await fullLogin(api, 'machine-2')).status, 200);

  const third = await fullLogin(api, 'machine-3');
  assert.equal(third.status, 403);
  assert.equal(third.body.error, 'device_limit');

  const reset = await fetch(`${api.baseUrl}/admin/users/${USER_ID}/reset-devices`, {
    method: 'POST',
    headers: { authorization: `Bearer ${api.config.adminSecret}` },
  });
  assert.equal(reset.status, 200);

  assert.equal((await fullLogin(api, 'machine-3')).status, 200);
});

test('refresh puis logout', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const { body } = await fullLogin(api);

  const refreshed = await fetch(`${api.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: body.refreshToken, deviceId: 'machine-1' }),
  });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  assert.ok(next.accessToken);

  const logout = await fetch(`${api.baseUrl}/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: next.refreshToken }),
  });
  assert.equal(logout.status, 204);

  const after = await fetch(`${api.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: next.refreshToken }),
  });
  assert.equal(after.status, 401);
  assert.equal((await after.json()).error, 'session_revoked');
});

test('une autre machine ne peut pas réutiliser la session', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const { body } = await fullLogin(api, 'machine-1');

  const stolen = await fetch(`${api.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: body.refreshToken, deviceId: 'machine-2' }),
  });
  assert.equal(stolen.status, 401);
  assert.equal((await stolen.json()).error, 'device_mismatch');
});

test('l\'admin exige le bon secret', async (t) => {
  const api = await startApi();
  t.after(() => api.close());

  const anonymous = await fetch(`${api.baseUrl}/admin/users`);
  assert.equal(anonymous.status, 401);

  const wrong = await fetch(`${api.baseUrl}/admin/users`, { headers: { authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);

  const right = await fetch(`${api.baseUrl}/admin/users`, {
    headers: { authorization: `Bearer ${api.config.adminSecret}` },
  });
  assert.equal(right.status, 200);
  assert.equal((await right.json()).count, 0);
});

test('un state signé vers une cible interdite ne redirige nulle part', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  api.discord.invite(USER_ID);

  const state = api.tokens.signState({ redirect: 'https://evil.example/steal' });
  const response = await fetch(`${api.baseUrl}/auth/callback?code=valid-code&state=${encodeURIComponent(state)}`, {
    redirect: 'manual',
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('location'), null);
});

test('un token bidon est refusé partout', async (t) => {
  const api = await startApi();
  t.after(() => api.close());

  const verify = await fetch(`${api.baseUrl}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'not.a.token' }),
  });
  assert.equal(verify.status, 401);

  const me = await fetch(`${api.baseUrl}/auth/me`, { headers: { authorization: 'Bearer not.a.token' } });
  assert.equal(me.status, 401);
});

test('healthz répond et la guild configurée est bien celle du contrôle', async (t) => {
  const api = await startApi();
  t.after(() => api.close());

  const health = await fetch(`${api.baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(api.config.discord.guildId, GUILD_ID);
  assert.equal(api.config.discord.accessRoleId, ROLE_ID);

  const missing = await fetch(`${api.baseUrl}/nope`);
  assert.equal(missing.status, 404);
});
