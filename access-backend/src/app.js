import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { jsonError } from './http.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createInternalRouter } from './routes/internal.js';

export function createApp({ config, store, tokens, discord, access, now = () => Date.now() }) {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      ...(config.isProduction ? {} : { hsts: false }),
    }),
  );

  if (config.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: config.corsOrigins,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Id'],
        maxAge: 600,
      }),
    );
  }

  app.use(express.json({ limit: '16kb' }));

  // Mounted before the global limiter: the game backend polls /verify.
  app.use(createInternalRouter({ store, tokens, access, now }));

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { ok: false, error: 'rate_limited', message: 'Trop de requêtes.' },
    }),
  );

  app.use('/auth', createAuthRouter({ config, store, tokens, discord, access, now }));
  app.use(createAdminRouter({ config, store, access }));

  app.use((req, res) => jsonError(res, 404, 'not_found', 'Route inconnue.'));

  // eslint-disable-next-line no-unused-vars -- Express detects the error handler by its 4 arguments.
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    if (error?.type === 'entity.parse.failed') {
      return jsonError(res, 400, 'invalid_json', 'Corps de requête JSON invalide.');
    }

    console.error('[access-backend] erreur non gérée:', error?.message ?? error);
    return jsonError(res, 500, 'internal_error', 'Erreur interne.');
  });

  return app;
}
