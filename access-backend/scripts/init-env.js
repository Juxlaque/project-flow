import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, '.env');
const template = path.join(root, '.env.example');

if (fs.existsSync(target)) {
  console.error('.env existe déjà — rien n\'a été modifié. Supprime-le si tu veux repartir de zéro.');
  process.exit(1);
}

const generate = (bytes) => crypto.randomBytes(bytes).toString('base64');

const content = fs
  .readFileSync(template, 'utf8')
  .replace(/^AUTH_JWT_SECRET=$/m, `AUTH_JWT_SECRET=${generate(48)}`)
  .replace(/^ADMIN_SECRET=$/m, `ADMIN_SECRET=${generate(32)}`);

fs.writeFileSync(target, content, { mode: 0o600 });

console.log('.env créé, avec AUTH_JWT_SECRET et ADMIN_SECRET déjà générés.');
console.log('');
console.log('Ouvre access-backend/.env et remplis ces 5 lignes (ne les colle pas dans le chat) :');
console.log('  DISCORD_CLIENT_ID');
console.log('  DISCORD_CLIENT_SECRET');
console.log('  DISCORD_BOT_TOKEN');
console.log('  DISCORD_GUILD_ID');
console.log('  DISCORD_ACCESS_ROLE_ID   (optionnel, vide = tout membre du serveur)');
console.log('');
console.log('Puis lance : npm run doctor');
