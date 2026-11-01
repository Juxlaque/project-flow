import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, bearerToken, jsonError, publicUser } from '../http.js';
import { safeEqual } from '../tokens.js';

const banSchema = z.object({
  discordId: z.string().regex(/^\d{15,25}$/),
  reason: z.string().max(200).optional(),
});

const idSchema = z.string().regex(/^\d{15,25}$/);

function requireAdmin(config) {
  return (req, res, next) => {
    const token = bearerToken(req);
    if (!token || !safeEqual(token, config.adminSecret)) {
      return jsonError(res, 401, 'unauthorized', 'Secret administrateur invalide.');
    }
    return next();
  };
}

export function createAdminRouter({ config, store, access }) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'rate_limited' },
  });

  router.use('/admin', limiter, requireAdmin(config));

  router.post(
    '/admin/ban',
    asyncHandler(async (req, res) => {
      const parsed = banSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'discordId (17-19 chiffres) requis.');
      }

      const user = await store.setBanned(parsed.data.discordId, true, parsed.data.reason ?? null);
      access.clearCache(parsed.data.discordId);
      return res.json({ ok: true, user: publicUser(user), sessionsRevoked: true });
    }),
  );

  router.post(
    '/admin/unban',
    asyncHandler(async (req, res) => {
      const parsed = banSchema.pick({ discordId: true }).safeParse(req.body ?? {});
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'discordId (17-19 chiffres) requis.');
      }

      const user = await store.setBanned(parsed.data.discordId, false, null);
      access.clearCache(parsed.data.discordId);
      return res.json({ ok: true, user: publicUser(user) });
    }),
  );

  router.post(
    '/admin/users/:discordId/reset-devices',
    asyncHandler(async (req, res) => {
      const parsed = idSchema.safeParse(req.params.discordId);
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'discordId invalide.');
      }

      const user = await store.resetDevices(parsed.data);
      if (!user) {
        return jsonError(res, 404, 'not_found', 'Utilisateur inconnu.');
      }

      return res.json({ ok: true, user: publicUser(user), sessionsRevoked: true });
    }),
  );

  router.get(
    '/admin/users/:discordId',
    asyncHandler(async (req, res) => {
      const parsed = idSchema.safeParse(req.params.discordId);
      if (!parsed.success) {
        return jsonError(res, 400, 'invalid_request', 'discordId invalide.');
      }

      const user = store.getUser(parsed.data);
      if (!user) {
        return jsonError(res, 404, 'not_found', 'Utilisateur inconnu.');
      }

      return res.json({ ok: true, user: publicUser(user) });
    }),
  );

  router.get('/admin/users', (req, res) => {
    const users = store.listUsers().map(publicUser);
    return res.json({ ok: true, count: users.length, users });
  });

  return router;
}
