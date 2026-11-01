import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { TokenService, safeEqual, sha256 } from '../src/tokens.js';

const secret = 's'.repeat(48);

function service(overrides = {}) {
  return new TokenService({
    secret,
    issuer: 'reboot-access',
    audience: 'reboot-launcher',
    accessTtlSeconds: 900,
    refreshTtlSeconds: 3600,
    stateTtlSeconds: 600,
    ...overrides,
  });
}

test('access token round-trip keeps the session and device binding', () => {
  const tokens = service();
  const token = tokens.signAccess({ userId: '42', username: 'cheater', sessionId: 'session-1', deviceHash: 'abc' });
  const payload = tokens.verifyAccess(token);

  assert.equal(payload.sub, '42');
  assert.equal(payload.sid, 'session-1');
  assert.equal(payload.dev, 'abc');
  assert.equal(payload.purpose, 'access');
  assert.ok(payload.exp > payload.iat);
});

test('a refresh token cannot be used as an access token', () => {
  const tokens = service();
  const refresh = tokens.signRefresh({ userId: '42', sessionId: 'session-1', deviceHash: null });
  assert.throws(() => tokens.verifyAccess(refresh));
});

test('expired tokens are rejected', () => {
  const tokens = service({ accessTtlSeconds: -10 });
  const token = tokens.signAccess({ userId: '42', username: 'cheater', sessionId: 's', deviceHash: null });
  assert.throws(() => tokens.verifyAccess(token));
});

test('a token signed with another secret is rejected', () => {
  const tokens = service();
  const forged = jwt.sign({ purpose: 'access', sub: '42', sid: 'x' }, 'o'.repeat(48), {
    algorithm: 'HS256',
    issuer: 'reboot-access',
    audience: 'reboot-launcher',
    expiresIn: 900,
  });
  assert.throws(() => tokens.verifyAccess(forged));
});

test('state tokens carry the redirect target', () => {
  const tokens = service();
  const state = tokens.signState({ redirect: 'rebootlauncher://auth' });
  assert.equal(tokens.verifyState(state).redirect, 'rebootlauncher://auth');
});

test('sha256 and safeEqual behave', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
  assert.equal(safeEqual('secret-value', 'secret-value'), true);
  assert.equal(safeEqual('secret-value', 'secret-valu3'), false);
});

test('a short secret is refused', () => {
  assert.throws(() => service({ secret: 'too-short' }));
});
