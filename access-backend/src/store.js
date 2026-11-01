import fs from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = 1;

function emptyData() {
  return {
    version: SCHEMA_VERSION,
    users: {},
    sessions: {},
    loginCodes: {},
  };
}

/**
 * Persistent state without a database server: a single JSON file, written
 * atomically (tmp file + rename) through a serialized queue. On Render, point
 * DATA_DIR at a mounted disk so it survives redeploys.
 */
export class Store {
  constructor({ file }) {
    this.file = file;
    this.data = emptyData();
    this.queue = Promise.resolve();
  }

  static async open(file) {
    const store = new Store({ file });
    await fs.mkdir(path.dirname(file), { recursive: true });

    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SCHEMA_VERSION) {
        throw new Error(`Schéma de données inconnu (${parsed?.version}) dans ${file}.`);
      }
      store.data = { ...emptyData(), ...parsed };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await store.flush();
    }

    return store;
  }

  async flush() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, this.file);
  }

  mutate(change) {
    const run = this.queue.then(async () => {
      const result = change(this.data);
      await this.flush();
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---------------------------------------------------------------- users ---

  getUser(userId) {
    return this.data.users[userId] ?? null;
  }

  listUsers() {
    return Object.values(this.data.users);
  }

  upsertUser({ id, username, globalName, avatar }) {
    return this.mutate((data) => {
      const now = Date.now();
      const user = data.users[id] ?? {
        id,
        username,
        globalName: globalName ?? null,
        avatar: avatar ?? null,
        createdAt: now,
        banned: false,
        banReason: null,
        bannedAt: null,
        devices: [],
      };

      user.username = username;
      user.globalName = globalName ?? null;
      user.avatar = avatar ?? null;
      user.lastLoginAt = now;
      data.users[id] = user;
      return user;
    });
  }

  setBanned(userId, banned, reason) {
    return this.mutate((data) => {
      const now = Date.now();
      const user = data.users[userId] ?? {
        id: userId,
        username: null,
        globalName: null,
        avatar: null,
        createdAt: now,
        devices: [],
        lastLoginAt: null,
      };

      user.banned = banned;
      user.banReason = banned ? reason ?? null : null;
      user.bannedAt = banned ? now : null;
      data.users[userId] = user;

      if (banned) {
        for (const [sessionId, session] of Object.entries(data.sessions)) {
          if (session.userId === userId) {
            delete data.sessions[sessionId];
          }
        }
      }

      return user;
    });
  }

  // -------------------------------------------------------------- devices ---

  bindDevice(userId, hash, { label = null, maxDevices = 2 } = {}) {
    return this.mutate((data) => {
      const user = data.users[userId];
      if (!user) {
        return { ok: false, reason: 'unknown_user' };
      }

      const now = Date.now();
      user.devices ??= [];

      const known = user.devices.find((device) => device.hash === hash);
      if (known) {
        known.lastSeenAt = now;
        if (label) {
          known.label = label;
        }
        return { ok: true, created: false, device: known };
      }

      if (user.devices.length >= maxDevices) {
        return { ok: false, reason: 'device_limit' };
      }

      const device = { hash, createdAt: now, lastSeenAt: now, label };
      user.devices.push(device);
      return { ok: true, created: true, device };
    });
  }

  resetDevices(userId) {
    return this.mutate((data) => {
      const user = data.users[userId];
      if (!user) {
        return null;
      }
      user.devices = [];
      for (const [sessionId, session] of Object.entries(data.sessions)) {
        if (session.userId === userId) {
          delete data.sessions[sessionId];
        }
      }
      return user;
    });
  }

  // ------------------------------------------------------------- sessions ---

  createSession({ id, userId, deviceHash, expiresAt }) {
    return this.mutate((data) => {
      const now = Date.now();
      const session = { id, userId, deviceHash: deviceHash ?? null, createdAt: now, lastSeenAt: now, expiresAt };
      data.sessions[id] = session;
      return session;
    });
  }

  getSession(sessionId) {
    if (!sessionId) {
      return null;
    }
    const session = this.data.sessions[sessionId] ?? null;
    if (session && session.expiresAt <= Date.now()) {
      return null;
    }
    return session;
  }

  touchSession(sessionId) {
    return this.mutate((data) => {
      const session = data.sessions[sessionId];
      if (session) {
        session.lastSeenAt = Date.now();
      }
    });
  }

  deleteSession(sessionId) {
    return this.mutate((data) => {
      delete data.sessions[sessionId];
    });
  }

  deleteSessionsOfUser(userId) {
    return this.mutate((data) => {
      for (const [sessionId, session] of Object.entries(data.sessions)) {
        if (session.userId === userId) {
          delete data.sessions[sessionId];
        }
      }
    });
  }

  // ---------------------------------------------------------- login codes ---

  createLoginCode(hash, { userId, expiresAt }) {
    return this.mutate((data) => {
      data.loginCodes[hash] = { userId, expiresAt, createdAt: Date.now() };
    });
  }

  /** Single use: the entry is deleted whether it is valid or already expired. */
  consumeLoginCode(hash) {
    return this.mutate((data) => {
      const entry = data.loginCodes[hash];
      if (!entry) {
        return null;
      }
      delete data.loginCodes[hash];
      return entry;
    });
  }

  prune(now = Date.now()) {
    return this.mutate((data) => {
      for (const [sessionId, session] of Object.entries(data.sessions)) {
        if (session.expiresAt <= now) {
          delete data.sessions[sessionId];
        }
      }
      for (const [hash, code] of Object.entries(data.loginCodes)) {
        if (code.expiresAt <= now) {
          delete data.loginCodes[hash];
        }
      }
    });
  }
}
