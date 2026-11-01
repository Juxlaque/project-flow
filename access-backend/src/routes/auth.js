import crypto from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { ACCESS_REASONS } from '../access.js';
import { asyncHandler, bearerToken, jsonError, publicUser } from '../http.js';
import { sha256 } from '../tokens.js';

const exchangeSchema = z.object({
  code: z.string().min(10).max(512),
  deviceId: z.string().min(8).max(512).optional(),
  deviceLabel: z.string().max(64).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(4096),
  deviceId: z.string().min(8).max(512).optional(),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(10).max(4096),
});

function parseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function sameTarget(left, right) {
  const trim = (value) => value.replace(/\/+$/, '');
  return left.protocol === right.protocol && left.host === right.host && trim(left.pathname) === trim(right.pathname);
}

/** Only application schemes declared in ALLOWED_REDIRECTS may receive a code. */
function resolveRedirect(raw, allowed) {
  const candidate = parseUrl(raw);
  if (!candidate) {
    return null;
  }
  for (const entry of allowed) {
    const allowedUrl = parseUrl(entry);
    if (allowedUrl && sameTarget(candidate, allowedUrl)) {
      return candidate;
    }
  }
  return null;
}

function withQuery(target, params) {
  const url = new URL(target.toString());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function sendPage(res, status, title, message) {
  res.status(status).set('content-type', 'text/html; charset=utf-8').set('cache-control', 'no-store').send(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
      `<title>${title}</title></head>` +
      '<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">' +
      `<main style="max-width:32rem;text-align:center"><h1 style="font-size:1.1rem">${title}</h1><p>${message}</p></main></body></html>`,
  );
  return res;
}

function hmac(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

export function createAuthRouter({ config, store, tokens, discord, access, now = () => Date.now() }) {
  const router = express.Router();
  const callbackUrl = `${config.publicBaseUrl}/auth/callback`;

  const loginLimiter = rateLimit({
    windowMs: 5 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'rate_limited', message: 'Trop de tentatives de connexion.' },
  });

  const tokenLimiter = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'rate_limited', message: 'Trop de requêtes. Réessaie dans une minute.' },
  });

  function redirectWith(target, params) {
    return withQuery(target, params);
  }

  async function issueSession({ userId, deviceHash, username }) {
    const sessionId = tokens.newSessionId();
    await store.createSession({
      id: sessionId,
      userId,
      deviceHash,
      expiresAt: now() + config.refreshTtlSeconds * 1000,
    });

    return {
      ok: true,
      tokenType: 'Bearer',
      accessToken: tokens.signAccess({ userId, username, sessionId, deviceHash }),
      refreshToken: tokens.signRefresh({ userId, sessionId, deviceHash }),
      expiresIn: config.accessTtlSeconds,
    };
  }

  // 1. The launcher opens this URL in the system browser.
  router.get('/discord', loginLimiter, (req, res) => {
    const redirect =
      resolveRedirect(req.query.redirect, config.allowedRedirects) ??
      resolveRedirect(config.allowedRedirects[0], config.allowedRedirects);

    if (!redirect) {
      return sendPage(res, 500, 'Configuration invalide', 'Aucune redirection autorisée : vérifie ALLOWED_REDIRECTS.');
    }

    const state = tokens.signState({ redirect: redirect.toString() });
    return res.redirect(302, discord.authorizeUrl({ redirectUri: callbackUrl, state }));
  });

  // 2. Discord sends the player back here; we hand a one-time code to the app.
  router.get(
    '/callback',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const redirect = (() => {
        try {
          // Re-checked against the allowlist even though we signed the state:
          // a redirect target must never be taken on trust.
          return resolveRedirect(tokens.verifyState(String(req.query.state ?? '')).redirect, config.allowedRedirects);
        } catch {
          return null;
        }
      })();

      const fail = (code, message) => {
        if (redirect) {
          return res.redirect(302, redirectWith(redirect, { error: code }));
        }
        return sendPage(res, 400, 'Connexion impossible', message);
      };

      if (req.query.error) {
        return fail('discord_denied', 'La connexion Discord a été annulée.');
      }

      if (typeof req.query.code !== 'string' || !redirect) {
        return fail('invalid_callback', 'Réponse Discord invalide.');
      }

      let profile;
      try {
        const token = await discord.exchangeCode({ code: req.query.code, redirectUri: callbackUrl });
        profile = await discord.fetchUser(token.access_token);
      } catch (error) {
        console.error('[auth] échange Discord impossible:', error.message);
        return fail('discord_error', 'Échange avec Discord impossible.');
      }

      const user = await store.upsertUser(profile);
      access.clearCache(user.id);

      const decision = await access.evaluate(user.id);
      if (!decision.allowed) {
        return fail(decision.reason, ACCESS_REASONS[decision.reason] ?? 'Accès refusé.');
      }

      const code = tokens.newLoginCode();
      await store.createLoginCode(sha256(code), {
        userId: user.id,
        expiresAt: now() + config.loginCodeTtlSeconds * 1000,
      });

      return res.redirect(302, redirectWith(redirect, { code }));
    }),
  );

  // 3. The launcher exchanges the one-time code (plus its device id) for tokens.
  router.post(
    '/exchange',
    tokenLimiter,
    asyncHandler(async (req, res) => {
      const parsed = exchangeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'Corps de requête invalide.');
      }

      const { code, deviceId, deviceLabel } = parsed.data;
      const entry = await store.consumeLoginCode(sha256(code));
      if (!entry) {
        return jsonError(res, 400, 'invalid_code', 'Code de connexion invalide ou déjà utilisé.');
      }
      if (entry.expiresAt <= now()) {
        return jsonError(res, 400, 'expired_code', 'Code de connexion expiré, reconnecte-toi.');
      }

      const user = store.getUser(entry.userId);
      if (!user) {
        return jsonError(res, 401, 'unknown_user', ACCESS_REASONS.unknown_user);
      }
      if (user.banned) {
        return jsonError(res, 403, 'banned', ACCESS_REASONS.banned);
      }

      if (config.requireDevice && !deviceId) {
        return jsonError(res, 400, 'device_required', 'Identifiant machine (deviceId) obligatoire.');
      }

      const deviceHash = deviceId ? hmac(deviceId, config.jwtSecret) : null;
      if (deviceHash) {
        const binding = await store.bindDevice(user.id, deviceHash, {
          label: deviceLabel ?? null,
          maxDevices: config.maxDevices,
        });
        if (!binding.ok) {
          if (binding.reason === 'device_limit') {
            return jsonError(
              res,
              403,
              'device_limit',
              `Limite de ${config.maxDevices} machine(s) atteinte pour ce compte. Demande une réinitialisation.`,
            );
          }
          return jsonError(res, 403, binding.reason, 'Accès refusé.');
        }
      }

      const decision = await access.evaluate(user.id);
      if (!decision.allowed) {
        return jsonError(res, 403, decision.reason, ACCESS_REASONS[decision.reason] ?? 'Accès refusé.');
      }

      const tokensPayload = await issueSession({
        userId: user.id,
        deviceHash,
        username: user.username,
      });

      res.set('cache-control', 'no-store');
      return res.json({
        ...tokensPayload,
        user: publicUser(user),
      });
    }),
  );

  // 4. Silent re-login once the access token expired.
  router.post(
    '/refresh',
    tokenLimiter,
    asyncHandler(async (req, res) => {
      const parsed = refreshSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'Corps de requête invalide.');
      }

      let payload;
      try {
        payload = tokens.verifyRefresh(parsed.data.refreshToken);
      } catch {
        return jsonError(res, 401, 'invalid_token', 'Refresh token invalide ou expiré.');
      }

      const session = store.getSession(payload.sid);
      if (!session || session.userId !== payload.sub) {
        return jsonError(res, 401, 'session_revoked', 'Session expirée, reconnecte-toi via Discord.');
      }

      if (session.deviceHash) {
        const provided = parsed.data.deviceId ? hmac(parsed.data.deviceId, config.jwtSecret) : null;
        if (provided && provided !== session.deviceHash) {
          return jsonError(res, 401, 'device_mismatch', 'Cette session appartient à une autre machine.');
        }
      }

      const user = store.getUser(payload.sub);
      if (!user) {
        return jsonError(res, 401, 'unknown_user', ACCESS_REASONS.unknown_user);
      }
      if (user.banned) {
        await store.deleteSession(session.id);
        return jsonError(res, 403, 'banned', ACCESS_REASONS.banned);
      }

      const decision = await access.evaluate(user.id);
      if (!decision.allowed) {
        await store.deleteSession(session.id);
        return jsonError(res, 403, decision.reason, ACCESS_REASONS[decision.reason] ?? 'Accès refusé.');
      }

      await store.touchSession(session.id);

      const tokensPayload = await issueSession({
        userId: user.id,
        deviceHash: session.deviceHash,
        username: user.username,
      });

      res.set('cache-control', 'no-store');
      return res.json({
        ...tokensPayload,
        user: publicUser(user),
      });
    }),
  );

  // 5. Logout revokes the session, so the access token dies immediately.
  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const parsed = logoutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'Corps de requête invalide.');
      }

      try {
        const payload = tokens.verifyRefresh(parsed.data.refreshToken);
        await store.deleteSession(payload.sid);
      } catch {
        // An unreadable token is already worthless: nothing to revoke.
      }

      return res.status(204).end();
    }),
  );

  // 6. Who am I, and may I still play?
  router.get(
    '/me',
    tokenLimiter,
    asyncHandler(async (req, res) => {
      const token = bearerToken(req);
      if (!token) {
        return jsonError(res, 401, 'missing_token', 'Token d\'accès manquant.');
      }

      let payload;
      try {
        payload = tokens.verifyAccess(token);
      } catch {
        return jsonError(res, 401, 'invalid_token', 'Token d\'accès invalide ou expiré.');
      }

      const user = store.getUser(payload.sub);
      if (!user) {
        return jsonError(res, 401, 'unknown_user', ACCESS_REASONS.unknown_user);
      }
      if (user.banned) {
        return jsonError(res, 403, 'banned', ACCESS_REASONS.banned);
      }

      const session = store.getSession(payload.sid);
      if (!session) {
        return jsonError(res, 401, 'session_revoked', 'Session révoquée, reconnecte-toi via Discord.');
      }

      const decision = await access.evaluate(user.id);
      if (!decision.allowed) {
        return jsonError(res, 403, decision.reason, ACCESS_REASONS[decision.reason] ?? 'Accès refusé.');
      }

      res.set('cache-control', 'no-store');
      return res.json({
        ok: true,
        user: publicUser(user),
        device: { bound: Boolean(session.deviceHash) },
        access: { allowed: true, roles: decision.roles ?? [] },
      });
    }),
  );

  return router;
}
