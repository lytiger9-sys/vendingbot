const guildCache = new Map();
const memberCache = new Map();

const GUILD_TTL_MS = 5 * 60 * 1000;
const MEMBER_TTL_MS = 30 * 1000;

function getCached(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(cache, key, value, ttl) {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

export async function fetchGuildCached(client, guildId) {
  const key = String(guildId);
  const cached = getCached(guildCache, key);
  if (cached) return cached;

  const pending = guildCache.get(key)?.pending;
  if (pending) return pending;

  const request = client.guilds.fetch(guildId)
    .then(guild => setCached(guildCache, key, guild, GUILD_TTL_MS))
    .catch(error => {
      guildCache.delete(key);
      throw error;
    });

  guildCache.set(key, { pending: request, value: null, expiresAt: 0 });
  return request;
}

export async function fetchMemberCached(guild, userId) {
  const key = `${guild.id}:${userId}`;
  const cached = getCached(memberCache, key);
  if (cached) return cached;

  const pending = memberCache.get(key)?.pending;
  if (pending) return pending;

  const request = guild.members.fetch(userId)
    .then(member => setCached(memberCache, key, member, MEMBER_TTL_MS))
    .catch(error => {
      memberCache.delete(key);
      throw error;
    });

  memberCache.set(key, { pending: request, value: null, expiresAt: 0 });
  return request;
}

export function invalidateMemberCache(guildId, userId) {
  memberCache.delete(`${guildId}:${userId}`);
}

export function clearDiscordCaches() {
  guildCache.clear();
  memberCache.clear();
}
