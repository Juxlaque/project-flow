import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import { AccessPolicy } from './access.js';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { DiscordClient } from './discord.js';
import { Store } from './store.js';
import { TokenService } from './tokens.js';

dotenv.config({ quiet: true });

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      console.error('\nCopie .env.example vers .env (ou renseigne ces variables sur Render) puis relance.');
      process.exit(1);
    }
    throw error;
  }

  const store = await Store.open(path.join(config.dataDir, 'access.json'));
  const tokens = new TokenService({
    secret: config.jwtSecret,
    issuer: config.issuer,
    audience: config.audience,
    accessTtlSeconds: config.accessTtlSeconds,
    refreshTtlSeconds: config.refreshTtlSeconds,
    stateTtlSeconds: config.stateTtlSeconds,
  });
  const discord = new DiscordClient(config.discord);
  const access = new AccessPolicy({ discord, store, config });

  const app = createApp({ config, store, tokens, discord, access });
  const server = app.listen(config.port, () => {
    console.log(`[access-backend] à l'écoute sur le port ${config.port}`);
    console.log(`[access-backend] callback Discord : ${config.publicBaseUrl}/auth/callback`);
    console.log(`[access-backend] serveur requis  : ${config.discord.guildId}`);
    console.log(`[access-backend] rôle requis     : ${config.discord.accessRoleId ?? '(aucun)'}`);
    console.log(`[access-backend] données         : ${path.join(config.dataDir, 'access.json')}`);
    console.log(`[access-backend] machines max    : ${config.maxDevices} (obligatoire: ${config.requireDevice})`);
  });

  const pruneTimer = setInterval(() => {
    store.prune().catch((error) => console.error('[access-backend] prune:', error.message));
  }, 5 * 60_000);
  pruneTimer.unref();

  const shutdown = (signal) => {
    console.log(`[access-backend] ${signal} reçu, arrêt...`);
    server.close(() => {
      store.flush().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[access-backend] démarrage impossible:', error);
  process.exit(1);
});
