import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { ACCESS_REASONS } from '../access.js';
import { asyncHandler, bearerToken, jsonError } from '../http.js';

/**
 * Endpoints for the game backend (the Fortnite one) and for monitoring.
 * The Fortnite backend can also verify the JWT offline with AUTH_JWT_SECRET;
 * /verify adds the live checks it cannot do alone (ban + revoked session).
 */
export function createInternalRouter({ store, tokens, access, now = () => Date.now() }) {
  const router = express.Router();
  const startedAt = now();

  const verifyLimiter = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'rate_limited' },
  });

  router.get('/healthz', (req, res) => {
    res.set('cache-control', 'no-store');
    res.json({ ok: true, service: 'reboot-access-backend', uptimeSeconds: Math.round((now() - startedAt) / 1000) });
  });

  router.post(
    '/verify',
    verifyLimiter,
    asyncHandler(async (req, res) => {
      const token = typeof req.body?.token === 'string' ? req.body.token : bearerToken(req);
      if (!token) {
        return jsonError(res, 400, 'missing_token', 'Token manquant.');
      }

      let payload;
      try {
        payload = tokens.verifyAccess(token);
      } catch {
        return jsonError(res, 401, 'invalid_token', 'Token invalide ou expiré.');
      }

      const user = store.getUser(payload.sub);
      if (!user) {
        return jsonError(res, 401, 'unknown_user', ACCESS_REASONS.unknown_user);
      }
      if (user.banned) {
        return jsonError(res, 403, 'banned', ACCESS_REASONS.banned);
      }

      const session = store.getSession(payload.sid);
      if (!session || session.userId !== payload.sub) {
        return jsonError(res, 401, 'session_revoked', 'Session révoquée.');
      }

      const deep = ['1', 'true', 'yes'].includes(String(req.query.deep ?? '').toLowerCase());
      let roles = null;
      if (deep) {
        const decision = await access.evaluate(user.id);
        if (!decision.allowed) {
          return jsonError(res, 403, decision.reason, ACCESS_REASONS[decision.reason] ?? 'Accès refusé.');
        }
        roles = decision.roles ?? [];
      }

      res.set('cache-control', 'no-store');
      return res.json({
        ok: true,
        user: { id: user.id, username: user.username, globalName: user.globalName },
        session: { id: session.id, deviceBound: Boolean(session.deviceHash) },
        roles,
        expiresAt: payload.exp ? payload.exp * 1000 : null,
      });
    }),
  );

  return router;
}
