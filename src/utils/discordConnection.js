import { Events } from 'discord.js';

const CONNECTION_PROGRESS_LOG_INTERVAL_MS = 30_000;
const GATEWAY_READY_TIMEOUT_MS = 60_000;

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

  // Gateway 로그인 성공만으로 REST 매니저의 인증 상태가 보장되지 않는
  // 환경을 방어한다. DM·메시지 전송은 client.rest 토큰이 반드시 필요하다.
  client.rest.setToken(token);

  let onReady;
  let onReadyError;
  let readyTimeout;
  const startedAt = Date.now();
  const progressTimer = setInterval(() => {
    const waitedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    console.warn(`[discord login] still waiting for Gateway Ready (${waitedSeconds}s elapsed).`);
  }, CONNECTION_PROGRESS_LOG_INTERVAL_MS);

  const ready = new Promise((resolve, reject) => {
    onReady = resolve;
    onReadyError = reject;
    client.once(Events.ClientReady, onReady);
    readyTimeout = setTimeout(() => {
      const error = new Error(
        `Discord Gateway Ready timed out after ${GATEWAY_READY_TIMEOUT_MS / 1000} seconds`,
      );
      error.code = 'GATEWAY_READY_TIMEOUT';
      error.wsStatus = client.ws?.status;
      error.gatewayPing = client.ws?.ping;
      onReadyError(error);
    }, GATEWAY_READY_TIMEOUT_MS);
  });

  try {
    await client.login(token);
    console.log('[discord login] Gateway transport connected; waiting for Ready event.');
    await ready;
  } catch (error) {
    client.off(Events.ClientReady, onReady);
    if (readyTimeout) clearTimeout(readyTimeout);
    console.error('[discord login] Gateway Ready wait failed', {
      code: error?.code,
      message: error?.message,
      wsStatus: error?.wsStatus ?? client.ws?.status,
      gatewayPing: error?.gatewayPing ?? client.ws?.ping,
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
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
  }
}
