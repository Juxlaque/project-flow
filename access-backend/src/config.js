import path from 'node:path';
import process from 'node:process';

/**
 * Both errors are fatal on purpose: starting with a broken config would either
 * lock every player out or, worse, open the launcher to everyone.
 */
export class ConfigError extends Error {
  constructor(problems) {
    super(`Configuration invalide :\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function text(env, key) {
  const value = env[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function list(env, key, fallback) {
  const raw = text(env, key);
  if (!raw) {
    return fallback;
  }
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function integer(env, key, fallback) {
  const raw = text(env, key);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(env, key, fallback) {
  const raw = text(env, key).toLowerCase();
  if (!raw) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function isSnowflake(value) {
  return /^\d{15,25}$/.test(value);
}

export function loadConfig(env = process.env) {
  const problems = [];
  const nodeEnv = text(env, 'NODE_ENV') || 'development';
  const isProduction = nodeEnv === 'production';

  const clientId = text(env, 'DISCORD_CLIENT_ID');
  const clientSecret = text(env, 'DISCORD_CLIENT_SECRET');
  const rawBotToken = text(env, 'DISCORD_BOT_TOKEN');
  const botToken = rawBotToken.replace(/^Bot\s+/i, '');
  const guildId = text(env, 'DISCORD_GUILD_ID');
  const accessRoleId = text(env, 'DISCORD_ACCESS_ROLE_ID');
  const jwtSecret = text(env, 'AUTH_JWT_SECRET');
  const adminSecret = text(env, 'ADMIN_SECRET');
  const publicBaseUrl = text(env, 'PUBLIC_BASE_URL').replace(/\/+$/, '');

  if (!isSnowflake(clientId)) {
    problems.push('DISCORD_CLIENT_ID manquant ou invalide (17-19 chiffres, onglet OAuth2 de l\'application Discord).');
  }
  if (clientSecret.length < 20) {
    problems.push('DISCORD_CLIENT_SECRET manquant ou invalide (onglet OAuth2 -> Client Secret).');
  }
  if (botToken.length < 20) {
    problems.push('DISCORD_BOT_TOKEN manquant ou invalide (onglet Bot -> Reset Token).');
  }
  if (!isSnowflake(guildId)) {
    problems.push('DISCORD_GUILD_ID manquant ou invalide (ID du serveur Discord autorisé).');
  }
  if (accessRoleId && !isSnowflake(accessRoleId)) {
    problems.push('DISCORD_ACCESS_ROLE_ID invalide (ID de rôle attendu, ou laisse vide).');
  }
  if (jwtSecret.length < 32) {
    problems.push('AUTH_JWT_SECRET trop court : 32 caractères minimum (voir README pour le générer).');
  }
  if (adminSecret.length < 24) {
    problems.push('ADMIN_SECRET trop court : 24 caractères minimum (voir README pour le générer).');
  }

  let parsedBaseUrl = null;
  if (!publicBaseUrl) {
    problems.push('PUBLIC_BASE_URL manquant (ex: https://mon-backend.onrender.com).');
  } else {
    try {
      parsedBaseUrl = new URL(publicBaseUrl);
      if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
        problems.push('PUBLIC_BASE_URL doit être une URL http(s).');
        parsedBaseUrl = null;
      } else if (isProduction && parsedBaseUrl.protocol !== 'https:') {
        problems.push('PUBLIC_BASE_URL doit être en https en production (Render fournit https).');
      }
    } catch {
      problems.push('PUBLIC_BASE_URL n\'est pas une URL valide.');
    }
  }

  const allowedRedirects = list(env, 'ALLOWED_REDIRECTS', ['rebootlauncher://auth']);
  for (const redirect of allowedRedirects) {
    try {
      const parsed = new URL(redirect);
      if (isProduction && ['http:', 'https:'].includes(parsed.protocol) && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
        problems.push(`ALLOWED_REDIRECTS: "${redirect}" doit utiliser un schéma d'application (ex: rebootlauncher://auth) en production.`);
      }
    } catch {
      problems.push(`ALLOWED_REDIRECTS: "${redirect}" n'est pas une URL valide.`);
    }
  }

  const corsOrigins = list(env, 'CORS_ORIGINS', []);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  // A PORT of 0 (or out of range) would give a random/broken listener while
  // PUBLIC_BASE_URL keeps pointing at the documented port: fall back instead.
  const requestedPort = integer(env, 'PORT', 8787);
  const port = requestedPort > 0 && requestedPort < 65536 ? requestedPort : 8787;

  return Object.freeze({
    nodeEnv,
    isProduction,
    port,
    publicBaseUrl,
    dataDir: path.resolve(text(env, 'DATA_DIR') || './data'),
    issuer: text(env, 'AUTH_ISSUER') || 'reboot-access',
    audience: text(env, 'AUTH_AUDIENCE') || 'reboot-launcher',
    jwtSecret,
    adminSecret,
    accessTtlSeconds: integer(env, 'ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTtlSeconds: integer(env, 'REFRESH_TOKEN_TTL_SECONDS', 60 * 60 * 24 * 30),
    loginCodeTtlSeconds: integer(env, 'LOGIN_CODE_TTL_SECONDS', 120),
    stateTtlSeconds: integer(env, 'LOGIN_STATE_TTL_SECONDS', 600),
    accessCacheTtlMs: integer(env, 'ACCESS_CACHE_TTL_MS', 60_000),
    maxDevices: integer(env, 'MAX_DEVICES', 2),
    requireDevice: boolean(env, 'REQUIRE_DEVICE', false),
    allowedRedirects,
    corsOrigins,
    discord: Object.freeze({
      clientId,
      clientSecret,
      botToken,
      guildId,
      accessRoleId: accessRoleId || null,
      apiBase: text(env, 'DISCORD_API_BASE') || 'https://discord.com/api/v10',
    }),
  });
}
