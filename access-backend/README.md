# Access backend — accès au launcher via Discord

Ce service est **le portier** : personne ne rentre dans le launcher sans un compte
Discord membre de ton serveur (et, si tu veux, avec un rôle précis). Il tourne à
côté du launcher et à côté du backend Fortnite, il ne les remplace pas.

- **Pas de MongoDB**, pas de base de données à installer : un fichier JSON écrit
  atomiquement (`DATA_DIR/access.json`) + Discord comme source de vérité.
- **Aucun mot de passe** : OAuth2 Discord (`identify` uniquement) fait par le
  backend, jamais par le launcher.
- Le **bot** sert à une seule chose : vérifier que le joueur est bien sur le
  serveur et lire ses rôles. Ses permissions ne lui donnent aucun droit de
  modération.
- Les tokens sont des **JWT HS256 signés** : le backend Fortnite peut les vérifier
  hors ligne avec `AUTH_JWT_SECRET`, donc un launcher patché ne sert à rien s'il
  n'a pas de token valide (voir « Ce que ça empêche vraiment »).

## 1. Créer le bot / l'application Discord

1. Va sur <https://discord.com/developers/applications> → **New Application**.
   Nom libre (ex. `Reboot Access`).
2. Onglet **OAuth2** :
   - copie le **Client ID** → `DISCORD_CLIENT_ID`
   - **Reset Secret** puis copie le secret → `DISCORD_CLIENT_SECRET`
   - **Redirects** → ajoute exactement :
     - `https://TON-SERVICE.onrender.com/auth/callback`
     - `http://127.0.0.1:8787/auth/callback` (uniquement pour tester en local)
   - Scopes à cocher : **`identify`** seulement. (Pas besoin de `email`,
     `guilds`, `bot` côté user.) Ne coche pas `guilds.join` sauf si tu veux
     ajouter les joueurs au serveur automatiquement plus tard.
3. Onglet **Bot** :
   - **Reset Token** → copie le token → `DISCORD_BOT_TOKEN`
   - **Privileged Gateway Intents** → active **SERVER MEMBERS INTENT**.
     C'est ce qui autorise la lecture du membre (`GET /guilds/{id}/members/{id}`).
     Les deux autres intents (Presence, Message Content) : **laisse-les OFF**.
   - **Bot Permissions** : **aucune** (0). Il n'a pas besoin de lire les salons,
     d'envoyer des messages ni de modérer. Ne coche rien, pas même
     « Administrator ».
4. Onglet **OAuth2 → URL Generator**, ou utilise directement l'URL d'invitation
   (permissions = 0) en remplaçant `TON_CLIENT_ID` :

   ```
   https://discord.com/oauth2/authorize?client_id=TON_CLIENT_ID&scope=bot&permissions=0
   ```

   Invite le bot sur **ton** serveur (celui de `DISCORD_GUILD_ID`). S'il n'est pas
   sur le serveur, chaque vérification échoue avec un 403 explicite dans les logs.
5. Récupère les IDs (Discord → Paramètres → Avancés → **Mode développeur** ON,
   puis clic droit) :
   - clic droit sur le serveur → **Copier l'identifiant du serveur** →
     `DISCORD_GUILD_ID`
   - (optionnel) clic droit sur le rôle qui donne l'accès → **Copier l'identifiant
     du rôle** → `DISCORD_ACCESS_ROLE_ID`

### Ce dont tu as besoin en résumé

| Valeur | Où | Obligatoire |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` | OAuth2 → Client ID | oui |
| `DISCORD_CLIENT_SECRET` | OAuth2 → Client Secret | oui |
| `DISCORD_BOT_TOKEN` | Bot → Token | oui |
| `DISCORD_GUILD_ID` | clic droit sur le serveur | oui |
| `DISCORD_ACCESS_ROLE_ID` | clic droit sur le rôle | non (mais recommandé) |
| `AUTH_JWT_SECRET` | généré par toi (voir plus bas) | oui |
| `ADMIN_SECRET` | généré par toi | oui |
| `PUBLIC_BASE_URL` | URL du service | oui |

Scopes OAuth2 : **`identify`**. Permissions du bot : **0**. Intent : **Server
Members** (`GUILD_MEMBERS`) uniquement.

Génère les deux secrets (Git Bash / Linux / macOS) :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Sur PowerShell : `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`
fonctionne aussi.

## 2. Lancer en local

```bash
cd access-backend
npm install
npm run init-env          # crée .env et génère AUTH_JWT_SECRET + ADMIN_SECRET
# ... remplis les 5 lignes Discord dans .env (jamais dans un chat) ...
npm run doctor            # vérifie le format ET la connexion réelle au bot/serveur
npm start                 # http://127.0.0.1:8787/healthz
```

`npm run doctor` contrôle, sans jamais afficher les valeurs : présence et format
des variables, validité du token du bot, présence du bot sur le serveur,
**SERVER MEMBERS INTENT** activé (lecture des membres) et existence du rôle
d'accès. C'est le moyen le plus rapide de savoir ce qui bloque avant même de
déployer.

Le serveur refuse de démarrer si une variable manque : il liste précisément ce
qui pose problème plutôt que de tourner à moitié configuré.

Test rapide du portier dans un navigateur :

```
http://127.0.0.1:8787/auth/discord?redirect=rebootlauncher://auth
```

Tu passes par Discord ; en cas de succès le navigateur tente d'ouvrir
`rebootlauncher://auth?code=...` (normal : c'est le launcher qui consomme ce
code). En cas de refus il ouvre `rebootlauncher://auth?error=not_in_guild`
(ou `banned`, `missing_role`, `discord_unavailable`).

## 3. Déployer sur Render

### Option A — Blueprint (recommandé)

1. Pousse le repo (avec `access-backend/`) sur GitHub.
2. Render → **New → Blueprint** → choisis le repo. Render lit `render.yaml`
   (`rootDir: access-backend`, `npm ci --omit=dev`, `npm start`,
   health check `/healthz`).
3. Render demande les variables `sync: false` : colle Client ID, Client Secret,
   Bot Token, Guild ID, Role ID, puis `PUBLIC_BASE_URL` =
   `https://<nom-du-service>.onrender.com` (donne l'URL exacte, sans `/` final).
4. Deploy → l'URL doit répondre `{"ok":true,...}` sur `/healthz`.
5. **Retourne sur Discord → OAuth2 → Redirects** : ajoute
   `https://<nom-du-service>.onrender.com/auth/callback` si ce n'est pas déjà fait,
   sinon Discord renvoie `invalid redirect_uri`.

### Option B — à la main

Render → **New → Web Service** → repo → réglages :

| Champ | Valeur |
| --- | --- |
| Root Directory | `access-backend` |
| Runtime | Node |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |

Puis **Environment** : ajoute les mêmes variables que `.env.example`
(`NODE_ENV=production`, `PUBLIC_BASE_URL=https://...`, etc.).

### Garder le backend allumé

- **Plan Starter ($7/mois)** : service toujours actif, pas de cold start, la
  meilleure option pour un launcher distribué.
- **Plan free** : Render endort le service après **15 min sans trafic** (≈50 s de
  réveil). Deux conséquences : le premier joueur du matin attend, et le
  `/verify` du backend Fortnite peut timeouter juste après une mise en veille.
  Palliatif gratuit : UptimeRobot / cron-job.org qui appelle
  `https://TON-SERVICE.onrender.com/healthz` toutes les 10 minutes. Ça garde le
  process chaud mais **ce n'est pas une garantie de disponibilité** ; le quota
  gratuit de 750 h/mois ne couvre qu'un seul service.
- **Données persistantes** : sur le plan free le disque est éphémère → bans et
  machines liées sont perdus à chaque redeploy. Passe en Starter et attache un
  disque Render (`mountPath: /var/data`, `DATA_DIR=/var/data`), le bloc est
  prêt en commentaire dans `render.yaml`.
- Ne mets **jamais** plus d'une instance Render avec ce stockage fichier en
  même temps : chaque instance aurait sa propre copie de `access.json`.

## 4. API

Base : `https://TON-SERVICE.onrender.com`.

| Méthode | Route | Qui | Rôle |
| --- | --- | --- | --- |
| GET | `/healthz` | public | ping / monitoring |
| GET | `/auth/discord?redirect=rebootlauncher://auth` | navigateur | démarre l'OAuth2 |
| GET | `/auth/callback` | Discord | reçoit le code, renvoie `?code=` à l'app |
| POST | `/auth/exchange` | launcher | `{code, deviceId}` → tokens |
| POST | `/auth/refresh` | launcher | `{refreshToken, deviceId}` → nouveaux tokens |
| POST | `/auth/logout` | launcher | révoque la session |
| GET | `/auth/me` | launcher | état du compte + droit de jouer |
| POST | `/verify` | backend Fortnite | valide un access token (ajoute `?deep=1` pour revérifier Discord) |
| POST | `/admin/ban` | toi | `{discordId, reason}` |
| POST | `/admin/unban` | toi | `{discordId}` |
| POST | `/admin/users/:id/reset-devices` | toi | libère les machines |
| GET | `/admin/users[/:id]` | toi | liste / détail |

Réponse de `/auth/exchange` :

```json
{
  "ok": true,
  "tokenType": "Bearer",
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 900,
  "user": { "id": "123", "username": "joueur", "globalName": "Joueur", "banned": false, "devices": 1 }
}
```

Exemples :

```bash
# bannir un tricheur (révoque ses sessions immédiatement)
curl -X POST https://TON-SERVICE.onrender.com/admin/ban \
  -H "Authorization: Bearer $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"discordId":"123456789012345678","reason":"cheat"}'

# valider un token depuis le backend Fortnite
curl -X POST https://TON-SERVICE.onrender.com/verify \
  -H "Content-Type: application/json" \
  -d '{"token":"eyJ..."}'
```

## 5. Côté launcher (contrat à respecter)

1. Ouvre dans le **navigateur système** :
   `GET {BASE}/auth/discord?redirect=rebootlauncher://auth`
   (le navigateur est indispensable : Discord refuse d'être affiché dans une
   webview).
2. Le backend redirige vers `rebootlauncher://auth?code=...` (code valable
   2 minutes, à usage unique) ou `rebootlauncher://auth?error=...`.
3. `POST /auth/exchange` avec `{code, deviceId}` — `deviceId` doit être stable
   pour la machine (par ex. un hash du HWID), jamais l'ID Discord.
4. Garde `refreshToken`, appelle `POST /auth/refresh` quand l'access token
   expire (15 min par défaut).
5. Avant d'afficher les fonctions du launcher, appelle `GET /auth/me` ; en
   `401/403`, retour à l'écran de connexion.

## 6. Côté backend Fortnite (le vrai verrou)

Le launcher peut être patché : c'est le backend qui doit refuser les tokens
invalides. Deux façons, au choix.

Vérification hors ligne (aucun appel réseau, recommandé) :

```js
import jwt from 'jsonwebtoken';

function requireAccess(token) {
  const payload = jwt.verify(token, process.env.AUTH_JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'reboot-access',
    audience: 'reboot-launcher',
  });
  // payload.sub = ID Discord, payload.sid = session, payload.dev = machine
  return payload;
}
```

Vérification en ligne (ajoute les bans et les sessions révoquées, à faire au
moins une fois au login) :

```js
const res = await fetch(`${process.env.ACCESS_API}/verify?deep=1`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token }),
});
if (!res.ok) throw new Error('accès refusé');
```

Tant que le backend Fortnite ne vérifie rien, le login ne protège que
l'interface du launcher.

## 7. Ce que ça empêche vraiment

Bloqué par ce service : accès sans compte Discord, non-membre du serveur, membre
sans le rôle requis, compte banni (sessions coupées immédiatement), partage
massif d'un compte (limite de machines), rejeu d'un code de connexion, redirection
du code vers un site tiers, token réutilisé après un ban.

Ce que ça n'empêche pas, et qu'il faut assumer :

- **Un launcher patché** peut sauter l'écran de login. Seul le contrôle côté
  backend Fortnite (§6) rend le token obligatoire.
- **Le HWID est déclaratif** : un tricheur peut envoyer un faux `deviceId`. La
  limite de machines freine le partage, elle n'identifie personne.
- **Un bot Discord avec 0 permission** ne peut pas sanctionner : si tu veux du
  kick/ban automatique dans Discord, ce sera un second bot avec des permissions
  de modération, pas celui-ci.
- Un compte Discord volé reste un compte valide. Ajoute le rôle d'accès à la
  main après vérification si c'est un risque pour toi.

## 8. Dépannage

| Symptôme | Cause |
| --- | --- |
| `invalid redirect_uri` chez Discord | l'URL `/auth/callback` exacte (https, sans `/` final) n'est pas dans OAuth2 → Redirects |
| `Le bot n'a pas accès à ce serveur` dans les logs | bot pas invité, ou `DISCORD_GUILD_ID` d'un autre serveur |
| tout le monde est `not_in_guild` | Server Members Intent désactivé, ou mauvais `DISCORD_GUILD_ID` |
| `discord_unavailable` | Discord injoignable / 429 : le service refuse par sécurité, réessaie |
| tout le monde redevient inconnu après un deploy | plan free, disque éphémère → attache un disque Render |
| `device_limit` | le joueur a changé de PC : `POST /admin/users/:id/reset-devices` |
| bans perdus au restart | idem : `DATA_DIR` doit pointer vers le disque persistant |

## 9. Tests

```bash
npm test   # 27 tests : tokens, stockage, flux OAuth complet (Discord simulé), bans, machines
```
