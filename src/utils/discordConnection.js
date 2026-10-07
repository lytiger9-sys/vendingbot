import { Events } from 'discord.js';

const CONNECTION_PROGRESS_LOG_INTERVAL_MS = 30_000;
const GATEWAY_READY_TIMEOUT_MS = 60_000;
const GATEWAY_PREFLIGHT_TIMEOUT_MS = 15_000;

async function checkGatewayPreflight() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_PREFLIGHT_TIMEOUT_MS);

  try {
    const response = await fetch('https://discord.com/api/v10/gateway', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const body = await response.text();

    if (!response.ok) {
      const error = new Error(`Gateway preflight failed with HTTP ${response.status}`);
      error.code = 'GATEWAY_PREFLIGHT_HTTP_ERROR';
      error.status = response.status;
      error.responseBody = body.slice(0, 500);
      throw error;
    }

    console.log('[discord gateway preflight] ok', {
      status: response.status,
      gatewayUrl: (() => {
        try {
          return JSON.parse(body)?.url || null;
        } catch {
          return null;
        }
      })(),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      error.code = 'GATEWAY_PREFLIGHT_TIMEOUT';
      error.message = `Gateway preflight timed out after ${GATEWAY_PREFLIGHT_TIMEOUT_MS / 1000} seconds`;
    }
    console.error('[discord gateway preflight] failed', {
      code: error?.code,
      status: error?.status,
      message: error?.message,
      responseBody: error?.responseBody,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

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

  await checkGatewayPreflight();

  // Gateway 로그인 성공만으로 REST 매니저의 인증 상태가 보장되지 않는
  // 환경을 방어한다. DM·메시지 전송은 client.rest 토큰이 반드시 필요하다.
  client.rest.setToken(token);

  let onReady;
  let readyTimeout;
  let lastGatewayEvent = null;
  let lastGatewayDebug = null;
  const startedAt = Date.now();
  const progressTimer = setInterval(() => {
    const waitedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    console.warn(`[discord login] still waiting for Gateway Ready (${waitedSeconds}s elapsed).`);
  }, CONNECTION_PROGRESS_LOG_INTERVAL_MS);

  const recordGatewayDisconnect = (closeEvent, shardId) => {
    lastGatewayEvent = {
      type: 'shardDisconnect',
      shardId,
      code: closeEvent?.code,
      reason: closeEvent?.reason?.toString?.() || String(closeEvent?.reason || ''),
    };
  };
  const recordGatewayError = (error, shardId) => {
    lastGatewayEvent = {
      type: 'shardError',
      shardId,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    };
  };

  client.on(Events.ShardDisconnect, recordGatewayDisconnect);
  client.on(Events.ShardError, recordGatewayError);
  const recordGatewayDebug = (message) => {
    if (/gateway|connecting|hello|identify|ready|session|reconnect|close/i.test(String(message))) {
      lastGatewayDebug = String(message).slice(-1000);
    }
  };
  client.on('debug', recordGatewayDebug);

  const ready = new Promise((resolve) => {
    onReady = resolve;
    client.once(Events.ClientReady, onReady);
  });

  const loginAndWaitForReady = (async () => {
    await client.login(token);
    console.log('[discord login] Gateway transport connected; waiting for Ready event.');
    await ready;
  })();

  const timeout = new Promise((_, reject) => {
    readyTimeout = setTimeout(() => {
      const error = new Error(
        `Discord Gateway Ready timed out after ${GATEWAY_READY_TIMEOUT_MS / 1000} seconds`,
      );
      error.code = 'GATEWAY_READY_TIMEOUT';
      error.wsStatus = client.ws?.status;
      error.gatewayPing = client.ws?.ping;
      reject(error);
    }, GATEWAY_READY_TIMEOUT_MS);
  });

  try {
    // Promise.race attaches rejection handlers to both branches, so a stalled
    // client.login() cannot leave the timeout error as an unhandled rejection.
    await Promise.race([loginAndWaitForReady, timeout]);
  } catch (error) {
    client.off(Events.ClientReady, onReady);
    if (readyTimeout) clearTimeout(readyTimeout);
    console.error('[discord login] Gateway Ready wait failed', {
      code: error?.code,
      message: error?.message,
      wsStatus: error?.wsStatus ?? client.ws?.status,
      gatewayPing: error?.gatewayPing ?? client.ws?.ping,
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      lastGatewayEvent,
      lastGatewayDebug,
    });
    try {
      client.destroy();
    } catch (destroyError) {
      console.error('[discord login] failed to destroy stalled Gateway client', {
        name: destroyError?.name,
        message: destroyError?.message,
      });
    }
    throw error;
  } finally {
    clearInterval(progressTimer);
    if (readyTimeout) clearTimeout(readyTimeout);
    client.off(Events.ShardDisconnect, recordGatewayDisconnect);
    client.off(Events.ShardError, recordGatewayError);
    client.off('debug', recordGatewayDebug);
  }
}
