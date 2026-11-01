const DEFAULT_API_BASE = 'https://discord.com/api/v10';

export class DiscordError extends Error {
  constructor(message, { status = null, code = null, body = null } = {}) {
    super(message);
    this.name = 'DiscordError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/**
 * Two different credentials are used here:
 *  - the OAuth2 client id/secret to log the player in (scope `identify` only);
 *  - the bot token to read the member (and their roles) in the private guild.
 * The player's Discord token is never stored.
 */
export class DiscordClient {
  constructor({ clientId, clientSecret, botToken, guildId, apiBase = DEFAULT_API_BASE, fetchImpl = globalThis.fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.botToken = botToken;
    this.guildId = guildId;
    this.apiBase = apiBase;
    this.fetchImpl = fetchImpl;
  }

  authorizeUrl({ redirectUri, state }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'identify',
      state,
      prompt: 'consent',
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }

  async #request(url, init = {}, retries = 1) {
    const response = await this.fetchImpl(url, init);

    if (response.status === 429 && retries > 0) {
      const payload = await response.clone().json().catch(() => ({}));
      const retryAfterMs = Number(payload.retry_after ?? 1) * 1000;
      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(5000, Math.max(250, retryAfterMs + 100)));
      });
      return this.#request(url, init, retries - 1);
    }

    const raw = await response.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }

    if (!response.ok) {
      throw new DiscordError(`Discord a répondu ${response.status}.`, {
        status: response.status,
        code: typeof body === 'object' ? body?.code ?? null : null,
        body,
      });
    }

    return body;
  }

  async exchangeCode({ code, redirectUri }) {
    const form = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    return this.#request(`${this.apiBase}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  }

  async fetchUser(accessToken) {
    const profile = await this.#request(`${this.apiBase}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    return {
      id: profile.id,
      username: profile.username,
      globalName: profile.global_name ?? null,
      avatar: profile.avatar ?? null,
    };
  }

  /**
   * Returns the member when the player is in the guild, `null` when they are
   * not, and throws when the check itself cannot be performed (bot missing,
   * Discord down). The caller must fail closed on a throw.
   */
  async fetchMember(userId) {
    const response = await this.fetchImpl(`${this.apiBase}/guilds/${this.guildId}/members/${userId}`, {
      headers: { authorization: `Bot ${this.botToken}` },
    });

    if (response.status === 404) {
      await response.body?.cancel?.();
      return null;
    }

    if (response.status === 403) {
      await response.body?.cancel?.();
      throw new DiscordError(
        'Le bot n\'a pas accès à ce serveur : invite-le sur le serveur Discord et vérifie DISCORD_GUILD_ID.',
        { status: 403 },
      );
    }

    const raw = await response.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
    }

    if (!response.ok) {
      throw new DiscordError(`Discord a répondu ${response.status} sur la vérification du membre.`, {
        status: response.status,
        code: typeof body === 'object' ? body?.code ?? null : null,
      });
    }

    return {
      userId,
      roles: Array.isArray(body?.roles) ? body.roles : [],
      nick: body?.nick ?? null,
      joinedAt: body?.joined_at ?? null,
    };
  }
}
