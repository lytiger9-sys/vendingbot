import { Events } from 'discord.js';

/**
 * Connect a Discord client once and wait until it is actually ready to serve
 * interactions. discord.js manages Gateway resume/reconnect and REST 429
 * waiting internally, so callers must not implement a competing retry loop.
 */
export async function connectDiscord(client, token) {
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is not configured');
  }

  if (client.isReady()) {
    return;
  }

  let onReady;
  const ready = new Promise((resolve) => {
    onReady = resolve;
    client.once(Events.ClientReady, onReady);
  });

  try {
    await client.login(token);
    await ready;
  } catch (error) {
    client.off(Events.ClientReady, onReady);
    throw error;
  }
}
