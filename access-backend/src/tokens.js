import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

/**
 * All tokens are HS256 JWTs signed by this service. The Fortnite backend can
 * therefore verify an access token offline with AUTH_JWT_SECRET, without
 * calling us, which is what makes a patched launcher useless on its own.
 */
export class TokenService {
  constructor({ secret, issuer, audience, accessTtlSeconds, refreshTtlSeconds, stateTtlSeconds }) {
    if (!secret || secret.length < 32) {
      throw new Error('Secret JWT trop court.');
    }
    this.secret = secret;
    this.issuer = issuer;
    this.audience = audience;
    this.accessTtlSeconds = accessTtlSeconds;
    this.refreshTtlSeconds = refreshTtlSeconds;
    this.stateTtlSeconds = stateTtlSeconds;
  }

  #sign(payload, ttlSeconds) {
    return jwt.sign(payload, this.secret, {
      algorithm: 'HS256',
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: ttlSeconds,
      jwtid: crypto.randomUUID(),
    });
  }

  #verify(token, purpose) {
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Token manquant.');
    }

    const payload = jwt.verify(token, this.secret, {
      algorithms: ['HS256'],
      issuer: this.issuer,
      audience: this.audience,
      clockTolerance: 5,
    });

    if (typeof payload !== 'object' || payload.purpose !== purpose) {
      throw new Error('Type de token inattendu.');
    }

    return payload;
  }

  newSessionId() {
    return crypto.randomUUID();
  }

  newLoginCode() {
    return crypto.randomBytes(32).toString('base64url');
  }

  newNonce() {
    return crypto.randomBytes(16).toString('base64url');
  }

  signAccess({ userId, username, sessionId, deviceHash }) {
    return this.#sign(
      {
        purpose: 'access',
        sub: userId,
        name: username ?? null,
        sid: sessionId,
        dev: deviceHash ?? null,
      },
      this.accessTtlSeconds,
    );
  }

  signRefresh({ userId, sessionId, deviceHash }) {
    return this.#sign(
      {
        purpose: 'refresh',
        sub: userId,
        sid: sessionId,
        dev: deviceHash ?? null,
      },
      this.refreshTtlSeconds,
    );
  }

  signState({ redirect }) {
    return this.#sign(
      {
        purpose: 'state',
        redirect,
        nonce: this.newNonce(),
      },
      this.stateTtlSeconds,
    );
  }

  verifyAccess(token) {
    return this.#verify(token, 'access');
  }

  verifyRefresh(token) {
    return this.#verify(token, 'refresh');
  }

  verifyState(token) {
    return this.#verify(token, 'state');
  }
}
