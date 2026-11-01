export const ACCESS_REASONS = Object.freeze({
  ok: 'Accès autorisé.',
  unknown_user: 'Ce compte n\'est pas enregistré. Reconnecte-toi via Discord.',
  banned: 'Ce compte est banni du launcher.',
  not_in_guild: 'Tu n\'es pas membre du serveur Discord requis pour accéder au launcher.',
  missing_role: 'Il te manque le rôle requis sur le serveur Discord.',
  discord_unavailable: 'Impossible de vérifier ton accès auprès de Discord pour le moment. Réessaie dans quelques secondes.',
});

/**
 * Single place that decides whether a Discord account may use the launcher.
 * Discord stays the source of truth (guild + role), the local store only holds
 * bans, devices and sessions, so removing someone from the Discord server or
 * from the access role revokes access at the next check (<= ACCESS_CACHE_TTL_MS).
 */
export class AccessPolicy {
  constructor({ discord, store, config, now = () => Date.now() }) {
    this.discord = discord;
    this.store = store;
    this.config = config;
    this.now = now;
    this.cache = new Map();
  }

  clearCache(userId) {
    if (userId) {
      this.cache.delete(userId);
      return;
    }
    this.cache.clear();
  }

  async #member(userId) {
    const current = this.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > current) {
      return cached;
    }

    let entry;
    try {
      const member = await this.discord.fetchMember(userId);
      entry = { ok: true, member };
    } catch {
      // Cache outages briefly as well, so a Discord hiccup does not turn into
      // a request storm, but never as an authorization to play.
      entry = { ok: false, member: null };
    }

    entry.expiresAt = current + this.config.accessCacheTtlMs;
    this.cache.set(userId, entry);
    return entry;
  }

  async evaluate(userId) {
    const user = this.store.getUser(userId);
    if (!user) {
      return { allowed: false, reason: 'unknown_user' };
    }

    if (user.banned) {
      return { allowed: false, reason: 'banned' };
    }

    const { ok, member } = await this.#member(userId);
    if (!ok) {
      return { allowed: false, reason: 'discord_unavailable' };
    }

    if (member === null) {
      return { allowed: false, reason: 'not_in_guild' };
    }

    const roleId = this.config.discord.accessRoleId;
    if (roleId && !member.roles.includes(roleId)) {
      return { allowed: false, reason: 'missing_role' };
    }

    return { allowed: true, reason: 'ok', roles: member.roles };
  }
}
