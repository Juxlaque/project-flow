import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Store } from '../src/store.js';

async function tempStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'access-store-'));
  const file = path.join(directory, 'access.json');
  return { file, store: await Store.open(file) };
}

test('users survive a restart', async () => {
  const { file, store } = await tempStore();
  await store.upsertUser({ id: '1', username: 'cheater', globalName: 'Cheater', avatar: null });

  const reopened = await Store.open(file);
  assert.equal(reopened.getUser('1').username, 'cheater');
});

test('login codes are single use', async () => {
  const { store } = await tempStore();
  await store.createLoginCode('hash-1', { userId: '1', expiresAt: Date.now() + 60_000 });

  assert.equal(store.consumeLoginCode('hash-1') !== null, true);
  assert.equal(await store.consumeLoginCode('hash-1'), null);
});

test('two devices are bound, the third is refused', async () => {
  const { store } = await tempStore();
  await store.upsertUser({ id: '1', username: 'cheater' });

  assert.equal((await store.bindDevice('1', 'device-a', { maxDevices: 2 })).ok, true);
  assert.equal((await store.bindDevice('1', 'device-b', { maxDevices: 2 })).ok, true);

  const third = await store.bindDevice('1', 'device-c', { maxDevices: 2 });
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'device_limit');

  // Rebinding a known device is idempotent, not a new device.
  const again = await store.bindDevice('1', 'device-a', { maxDevices: 2 });
  assert.equal(again.ok, true);
  assert.equal(again.created, false);
});

test('a ban revokes every session of the user', async () => {
  const { store } = await tempStore();
  await store.upsertUser({ id: '1', username: 'cheater' });
  await store.createSession({ id: 'session-1', userId: '1', deviceHash: null, expiresAt: Date.now() + 60_000 });
  await store.createSession({ id: 'session-2', userId: '2', deviceHash: null, expiresAt: Date.now() + 60_000 });

  await store.setBanned('1', true, 'triche');

  assert.equal(store.getSession('session-1'), null);
  assert.notEqual(store.getSession('session-2'), null);
  assert.equal(store.getUser('1').banned, true);

  await store.setBanned('1', false, null);
  assert.equal(store.getUser('1').banned, false);
});

test('resetting devices also revokes the sessions', async () => {
  const { store } = await tempStore();
  await store.upsertUser({ id: '1', username: 'cheater' });
  await store.bindDevice('1', 'device-a', { maxDevices: 2 });
  await store.createSession({ id: 'session-1', userId: '1', deviceHash: 'device-a', expiresAt: Date.now() + 60_000 });

  const user = await store.resetDevices('1');

  assert.equal(user.devices.length, 0);
  assert.equal(store.getSession('session-1'), null);
});

test('expired sessions and codes are pruned', async () => {
  const { store } = await tempStore();
  await store.createSession({ id: 'old', userId: '1', deviceHash: null, expiresAt: Date.now() - 1000 });
  await store.createLoginCode('hash', { userId: '1', expiresAt: Date.now() - 1000 });

  await store.prune();

  assert.deepEqual(store.data.sessions, {});
  assert.deepEqual(store.data.loginCodes, {});
});
