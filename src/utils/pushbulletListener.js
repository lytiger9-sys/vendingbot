import { getPushbulletToken } from './runtimeConfig.js';
import { processPayment } from './paymentProcessor.js';

const PUSHBULLET_STREAM_URL = 'wss://stream.pushbullet.com/websocket/';
const MAX_RECONNECT_DELAY_MS = 60_000;
const PROCESSED_PUSH_TTL_MS = 10 * 60 * 1000;

let activeSocket = null;
let reconnectTimer = null;
let reconnectDelayMs = 1000;
let shouldStop = false;
let currentDependencies = null;
const processedPushes = new Map();

function pruneProcessedPushes(now = Date.now()) {
  for (const [key, timestamp] of processedPushes.entries()) {
    if (now - timestamp > PROCESSED_PUSH_TTL_MS) {
      processedPushes.delete(key);
    }
  }
}

function rememberPush(push) {
  const key = push?.iden || `${push?.source_device_iden ?? ''}:${push?.notification_id ?? ''}:${push?.notification_tag ?? ''}`;
  if (!key) {
    return true;
  }

  pruneProcessedPushes();
  if (processedPushes.has(key)) {
    return false;
  }

  processedPushes.set(key, Date.now());
  return true;
}

function buildMirrorContent(push) {
  return [push?.title, push?.body]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

async function handleMirrorPush(push) {
  if (!rememberPush(push)) {
    return;
  }

  const content = buildMirrorContent(push);
  if (!content) {
    return;
  }

  console.log(
    `[pushbullet] mirrored notification received from ${push?.application_name || 'unknown app'}`
  );

  await processPayment(
    {
      ...push,
      content
    },
    currentDependencies || {}
  );
}

function scheduleReconnect(connectFn) {
  if (shouldStop) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectFn();
  }, reconnectDelayMs);

  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

function connect() {
  const token = getPushbulletToken();
  if (!token) {
    console.log('Pushbullet token is not configured. Skipping Pushbullet stream listener.');
    return null;
  }

  shouldStop = false;

  try {
    const socket = new WebSocket(`${PUSHBULLET_STREAM_URL}${token}`);
    activeSocket = socket;

    socket.onopen = () => {
      reconnectDelayMs = 1000;
      console.log('[pushbullet] stream connected');
    };

    socket.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch (error) {
        console.warn('[pushbullet] invalid JSON received:', error);
        return;
      }

      if (!payload || payload.type !== 'push' || payload.push?.type !== 'mirror') {
        return;
      }

      void handleMirrorPush(payload.push).catch((error) => {
        console.error('[pushbullet] failed to process mirrored notification:', error);
      });
    };

    socket.onerror = (error) => {
      console.error('[pushbullet] websocket error:', error?.message || error);
    };

    socket.onclose = () => {
      activeSocket = null;

      if (shouldStop) {
        return;
      }

      console.warn('[pushbullet] stream disconnected. reconnecting...');
      scheduleReconnect(connect);
    };

    return socket;
  } catch (error) {
    console.error('[pushbullet] failed to open websocket:', error);
    scheduleReconnect(connect);
    return null;
  }
}

export function startPushbulletListener(dependencies = {}) {
  currentDependencies = dependencies;

  if (activeSocket && (
    activeSocket.readyState === WebSocket.OPEN ||
    activeSocket.readyState === WebSocket.CONNECTING
  )) {
    return activeSocket;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  reconnectDelayMs = 1000;
  shouldStop = false;
  return connect();
}

export function stopPushbulletListener() {
  shouldStop = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeSocket) {
    try {
      activeSocket.close();
    } catch (error) {
      // Ignore close errors.
    }
    activeSocket = null;
  }
}
