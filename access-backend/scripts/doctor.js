import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '..', '.env'), quiet: true });

const api = (process.env.DISCORD_API_BASE || 'https://discord.com/api/v10').replace(/\/+$/, '');
const ok = (label, detail = '') => console.log(`  \u2714 ${label}${detail ? `  ${detail}` : ''}`);
const bad = (label, detail = '') => console.log(`  \u2718 ${label}${detail ? `  ${detail}` : ''}`);

let failures = 0;

function check(label, value, { pattern, minLength, hint } = {}) {
  if (!value) {
    bad(label, `manquant — ${hint}`);
    failures += 1;
    return null;
  }
  if (pattern && !pattern.test(value)) {
    bad(label, `format inattendu — ${hint}`);
    failures += 1;
    return null;
  }
  if (minLength && value.length < minLength) {
    bad(label, `trop court (${value.length} caractères, ${minLength} minimum)`);
    failures += 1;
    return null;
  }
  ok(label, `(${value.length} caractères)`);
  return value;
}

console.log('\n== Configuration ==');
const clientId = check('DISCORD_CLIENT_ID', process.env.DISCORD_CLIENT_ID?.trim(), {
  pattern: /^\d{15,25}$/,
  hint: 'OAuth2 -> Client ID',
});
check('DISCORD_CLIENT_SECRET', process.env.DISCORD_CLIENT_SECRET?.trim(), {
  minLength: 20,
  hint: 'OAuth2 -> Reset Secret',
});
const botToken = check('DISCORD_BOT_TOKEN', process.env.DISCORD_BOT_TOKEN?.trim().replace(/^Bot\s+/i, ''), {
  minLength: 20,
  hint: 'Bot -> Reset Token',
});
const guildId = check('DISCORD_GUILD_ID', process.env.DISCORD_GUILD_ID?.trim(), {
  pattern: /^\d{15,25}$/,
  hint: 'clic droit sur le serveur -> Copier l\'identifiant',
});

const roleId = process.env.DISCORD_ACCESS_ROLE_ID?.trim() ?? '';
if (roleId) {
  check('DISCORD_ACCESS_ROLE_ID', roleId, { pattern: /^\d{15,25}$/, hint: 'clic droit sur le rôle' });
} else {
  ok('DISCORD_ACCESS_ROLE_ID', '(vide : tout membre du serveur)');
}

check('AUTH_JWT_SECRET', process.env.AUTH_JWT_SECRET?.trim(), { minLength: 32, hint: 'npm run init-env' });
check('ADMIN_SECRET', process.env.ADMIN_SECRET?.trim(), { minLength: 24, hint: 'npm run init-env' });
check('PUBLIC_BASE_URL', process.env.PUBLIC_BASE_URL?.trim(), {
  pattern: /^https?:\/\/[^\s]+$/,
  hint: 'http://127.0.0.1:8787 en local',
});

if (!botToken || !guildId) {
  console.log('\nRemplis les valeurs manquantes dans access-backend/.env puis relance npm run doctor.\n');
  process.exit(1);
}

async function call(pathname, token, as = 'Bot') {
  const response = await fetch(`${api}${pathname}`, {
    headers: { authorization: `${as} ${token}` },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

console.log('\n== Discord ==');

try {
  const me = await call('/users/@me', botToken);
  if (me.status === 401) {
    bad('Token du bot refusé (401)', 'Reset Token dans l\'onglet Bot puis recolle-le');
    failures += 1;
  } else if (me.status !== 200) {
    bad(`Bot injoignable (${me.status})`, me.body?.message ?? '');
    failures += 1;
  } else {
    ok('Bot connecté', `${me.body.username} (id ${me.body.id})`);

    const guild = await call(`/guilds/${guildId}?with_counts=true`, botToken);
    if (guild.status === 403 || guild.status === 404) {
      bad('Bot pas sur ce serveur', 'invite-le avec le lien scope=bot&permissions=0');
      failures += 1;
    } else if (guild.status !== 200) {
      bad(`Serveur illisible (${guild.status})`, guild.body?.message ?? '');
      failures += 1;
    } else {
      ok('Serveur trouvé', `${guild.body.name} — ${guild.body.approximate_member_count ?? '?'} membres`);

      const members = await call(`/guilds/${guildId}/members?limit=1`, botToken);
      if (members.status === 403) {
        bad(
          'SERVER MEMBERS INTENT désactivé',
          'Developer Portal -> Bot -> Privileged Gateway Intents -> Server Members Intent ON',
        );
        failures += 1;
      } else if (members.status === 200) {
        ok('Lecture des membres', 'le portier pourra vérifier qui est sur le serveur');
      } else {
        bad(`Lecture des membres impossible (${members.status})`, members.body?.message ?? '');
        failures += 1;
      }

      if (roleId) {
        const roles = await call(`/guilds/${guildId}/roles`, botToken);
        const role = Array.isArray(roles.body) ? roles.body.find((entry) => entry.id === roleId) : null;
        if (role) {
          ok('Rôle d\'accès trouvé', role.name);
        } else {
          bad('Rôle d\'accès introuvable sur ce serveur', `DISCORD_ACCESS_ROLE_ID=${roleId}`);
          failures += 1;
        }
      }
    }
  }
} catch (error) {
  bad('Discord injoignable', error.message);
  failures += 1;
}

console.log('');
if (failures > 0) {
  console.log(`${failures} problème(s) à corriger.`.trim());
  process.exit(1);
}

const requestedPort = Number.parseInt(process.env.PORT ?? '', 10);
const port = requestedPort > 0 && requestedPort < 65536 ? requestedPort : 8787;

console.log('Tout est prêt. Lance npm start, puis teste :');
console.log(`  http://127.0.0.1:${port}/auth/discord?redirect=rebootlauncher://auth`);
console.log('');
