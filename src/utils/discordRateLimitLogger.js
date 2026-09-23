import { RESTEvents } from '@discordjs/rest';

/**
 * Emit actionable diagnostics when Discord's REST manager is rate-limited.
 * The route is normalized by discord.js and does not contain bot credentials.
 */
export function attachDiscordRateLimitLogger(rest) {
  rest.on(RESTEvents.RateLimited, (rateLimit) => {
    console.warn('[discord api rate limit]', {
      global: rateLimit.global,
      method: rateLimit.method,
      route: rateLimit.route,
      retryAfterMs: Math.ceil(rateLimit.retryAfter),
    });
  });
}
