import { RESTEvents } from '@discordjs/rest';

const SNOWFLAKE_PATTERN = /\b\d{15,22}\b/g;

function normalizeRoute(route) {
  return String(route || 'unknown').replace(SNOWFLAKE_PATTERN, ':id');
}

function getRoute(options) {
  return normalizeRoute(options?.fullRoute || options?.route || options?.url || 'unknown');
}

function getErrorDetails(error) {
  return {
    name: error?.name,
    code: error?.code,
    status: error?.status,
    message: error?.message,
    rawMessage: error?.rawError?.message,
  };
}

/**
 * Record every bot REST request so a recurring route can be identified before
 * Discord returns a global 429. This does not retry, delay, or alter requests.
 */
export function attachDiscordRateLimitLogger(rest) {
  if (!rest || typeof rest.request !== 'function') {
    console.warn('[discord api diagnostics] REST manager does not expose request()');
    return;
  }

  const originalRequest = rest.request.bind(rest);
  let sequence = 0;
  let inFlight = 0;

  rest.request = async (options) => {
    const requestId = ++sequence;
    const method = String(options?.method || 'UNKNOWN').toUpperCase();
    const route = getRoute(options);
    const startedAt = Date.now();
    inFlight += 1;

    console.log('[discord api request start]', {
      requestId,
      method,
      route,
      inFlight,
    });

    try {
      const result = await originalRequest(options);
      console.log('[discord api request complete]', {
        requestId,
        method,
        route,
        durationMs: Date.now() - startedAt,
        inFlight: inFlight - 1,
      });
      return result;
    } catch (error) {
      console.error('[discord api request failed]', {
        requestId,
        method,
        route,
        durationMs: Date.now() - startedAt,
        inFlight: inFlight - 1,
        ...getErrorDetails(error),
      });
      throw error;
    } finally {
      inFlight -= 1;
    }
  };

  rest.on(RESTEvents.RateLimited, (rateLimit) => {
    console.warn('[discord api rate limit]', {
      global: rateLimit.global,
      method: rateLimit.method,
      route: normalizeRoute(rateLimit.route),
      retryAfterMs: Math.ceil(rateLimit.retryAfter),
      inFlight,
    });
  });

  rest.on(RESTEvents.InvalidRequestWarning, (warning) => {
    console.warn('[discord api invalid request warning]', {
      count: warning?.count,
      remainingTime: warning?.remainingTime,
    });
  });
}
