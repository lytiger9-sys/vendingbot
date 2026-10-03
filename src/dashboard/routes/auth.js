import express from 'express';
import passport from 'passport';
import { isAuthenticated } from '../middleware/auth.js';
import { prisma } from '../../index.js';

const router = express.Router();
let oauthBlockedUntil = 0;
const oauthRequestCooldown = new Map();
const oauthCallbackCooldown = new Map();
const OAUTH_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;
const OAUTH_GLOBAL_GATE_MS = 5 * 60 * 1000;
const OAUTH_GATE_SETTING = 'OAUTH_GLOBAL_GATE_UNTIL';
const OAUTH_BLOCK_SETTING = 'OAUTH_GLOBAL_BLOCK_UNTIL';
const MAX_OAUTH_GLOBAL_RETRIES = 2;

async function readOAuthTimestamp(key) {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  const timestamp = Number(setting?.value || 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function writeOAuthTimestamp(key, timestamp) {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: String(timestamp) },
    create: { key, value: String(timestamp) },
  });
}

async function tryAcquireGlobalOAuthGate() {
  const now = Date.now();
  const nextUntil = now + OAUTH_GLOBAL_GATE_MS;

  // Compare-and-set prevents separate Render instances from passing the gate together.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await prisma.systemSetting.findUnique({
      where: { key: OAUTH_GATE_SETTING },
    });

    if (!current) {
      try {
        await prisma.systemSetting.create({
          data: { key: OAUTH_GATE_SETTING, value: String(nextUntil) },
        });
        return 0;
      } catch (error) {
        if (error?.code !== 'P2002') throw error;
        continue;
      }
    }

    const currentUntil = Number(current.value || 0);
    if (Number.isFinite(currentUntil) && currentUntil > now) {
      return Math.ceil((currentUntil - now) / 1000);
    }

    const result = await prisma.systemSetting.updateMany({
      where: { key: OAUTH_GATE_SETTING, value: current.value },
      data: { value: String(nextUntil) },
    });

    if (result.count === 1) return 0;
  }

  return OAUTH_GLOBAL_GATE_MS / 1000;
}

async function getDistributedOAuthBlockSeconds() {
  const blockedUntil = await readOAuthTimestamp(OAUTH_BLOCK_SETTING);
  return blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0;
}

function getClientKey(req) {
  return req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function isOnOAuthCooldown(req) {
  const key = getClientKey(req);
  const until = oauthRequestCooldown.get(key) || 0;
  if (until > Date.now()) return Math.ceil((until - Date.now()) / 1000);
  oauthRequestCooldown.delete(key);
  return 0;
}

function setOAuthCooldown(req) {
  oauthRequestCooldown.set(getClientKey(req), Date.now() + OAUTH_REQUEST_COOLDOWN_MS);
}

function isCallbackOnCooldown(req) {
  const key = getClientKey(req);
  const until = oauthCallbackCooldown.get(key) || 0;
  if (until > Date.now()) return Math.ceil((until - Date.now()) / 1000);
  oauthCallbackCooldown.delete(key);
  return 0;
}

function isGlobalRateLimitError(error) {
  const message = String(error?.oauthError?.data?.message || error?.message || '');
  return message.toLowerCase().includes('global rate limit');
}

function getRetryAfterSeconds(error) {
  const retryAfter = error?.oauthError?.data?.retry_after;
  // Discord가 retry_after를 생략해도 짧은 간격으로 재요청하지 않는다.
  return Number.isFinite(Number(retryAfter)) ? Math.ceil(Number(retryAfter)) : 15 * 60;
}

function getOAuthRequestId(req) {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function retryOAuthCallback(req, res, next, requestId, attempt = 0) {
  passport.authenticate('discord', (err, user) => {
    if (err) {
      console.error(`[oauth] callback error request=${requestId} attempt=${attempt + 1}:`, err.oauthError?.data || err.oauthError || err);

      if (isGlobalRateLimitError(err)) {
        const retryAfter = getRetryAfterSeconds(err);
        const blockedUntil = Date.now() + retryAfter * 1000;
        oauthBlockedUntil = blockedUntil;
        void writeOAuthTimestamp(OAUTH_BLOCK_SETTING, blockedUntil).catch((blockError) => {
          console.error('[oauth gate] failed to persist Discord block state:', blockError);
        });

        if (attempt < MAX_OAUTH_GLOBAL_RETRIES && !res.headersSent) {
          console.warn(`[oauth] global rate limit; retrying callback request=${requestId} in ${retryAfter}s (${attempt + 1}/${MAX_OAUTH_GLOBAL_RETRIES})`);
          setTimeout(() => {
            if (!res.headersSent) {
              retryOAuthCallback(req, res, next, requestId, attempt + 1);
            }
          }, retryAfter * 1000);
          return;
        }

        res.set('Retry-After', String(retryAfter));
        return res.status(429).send(`Discord 로그인 요청이 일시적으로 제한되었습니다. ${retryAfter}초 후 다시 시도해주세요.`);
      }

      return res.status(502).send('Discord OAuth temporarily unavailable');
    }

    if (!user) {
      console.warn(`[oauth] callback returned no user request=${requestId}`);
      return res.redirect('/auth/login-failed');
    }

    req.logIn(user, (loginError) => {
      if (loginError) return next(loginError);
      return req.session.save((saveError) => {
        if (saveError) return next(saveError);
        console.log(`[oauth] login success request=${requestId}`);
        return res.redirect('/');
      });
    });
  })(req, res, next);
}

router.get('/csrf', isAuthenticated, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

router.get('/discord', async (req, res, next) => {
  const requestId = getOAuthRequestId(req);
  console.log(`[oauth] login start request=${requestId} ip=${getClientKey(req)}`);

  if (req.user) return res.redirect('/');

  const cooldownSeconds = isOnOAuthCooldown(req);
  if (cooldownSeconds > 0) {
    res.set('Retry-After', String(cooldownSeconds));
    return res.status(429).send(`로그인 요청이 이미 진행 중입니다. ${cooldownSeconds}초 후 다시 시도해주세요.`);
  }

  if (Date.now() < oauthBlockedUntil) {
    const retryAfter = Math.ceil((oauthBlockedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).send(`Discord 로그인 요청이 일시적으로 제한되었습니다. ${retryAfter}초 후 다시 시도해주세요.`);
  }

  try {
    const distributedBlockSeconds = await getDistributedOAuthBlockSeconds();
    if (distributedBlockSeconds > 0) {
      res.set('Retry-After', String(distributedBlockSeconds));
      return res.status(429).send(`Discord 로그인 요청이 일시적으로 제한되었습니다. ${distributedBlockSeconds}초 후 다시 시도해주세요.`);
    }

    const globalGateSeconds = await tryAcquireGlobalOAuthGate();
    if (globalGateSeconds > 0) {
      res.set('Retry-After', String(globalGateSeconds));
      return res.status(429).send(`다른 로그인 요청이 처리 중입니다. ${globalGateSeconds}초 후 다시 시도해주세요.`);
    }
  } catch (error) {
    // 전역 게이트를 확인하지 못한 상태에서 Discord로 요청하면
    // 차단 우회가 될 수 있으므로, DB 장애 시에는 OAuth를 시작하지 않는다.
    console.error(`[oauth gate] unavailable request=${requestId}:`, error);
    return res.status(503).send('로그인 제한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.');
  }

  setOAuthCooldown(req);
  console.log(`[oauth] redirecting to Discord request=${requestId}`);
  return passport.authenticate('discord')(req, res, next);
});

router.get('/discord/callback', async (req, res, next) => {
  const requestId = getOAuthRequestId(req);
  console.log(`[oauth] callback start request=${requestId} ip=${getClientKey(req)} hasCode=${Boolean(req.query.code)}`);

  // callback URL을 새로고침해도 전역 제한 중에는 Discord에 재요청하지 않습니다.
  if (Date.now() < oauthBlockedUntil) {
    const retryAfter = Math.ceil((oauthBlockedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).send(`Discord OAuth가 일시적으로 차단되어 있습니다. ${retryAfter}초 후 다시 시도해주세요.`);
  }

  try {
    const distributedBlockSeconds = await getDistributedOAuthBlockSeconds();
    if (distributedBlockSeconds > 0) {
      res.set('Retry-After', String(distributedBlockSeconds));
      return res.status(429).send(`Discord OAuth가 일시적으로 차단되어 있습니다. ${distributedBlockSeconds}초 후 다시 시도해주세요.`);
    }
  } catch (error) {
    console.error(`[oauth gate] unavailable on callback request=${requestId}:`, error);
    return res.status(503).send('로그인 제한 상태를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.');
  }

  const callbackCooldownSeconds = isCallbackOnCooldown(req);
  if (callbackCooldownSeconds > 0) {
    res.set('Retry-After', String(callbackCooldownSeconds));
    return res.status(429).send(`로그인 callback이 중복 요청되었습니다. ${callbackCooldownSeconds}초 후 다시 시도해주세요.`);
  }

  oauthCallbackCooldown.set(getClientKey(req), Date.now() + OAUTH_REQUEST_COOLDOWN_MS);
  return retryOAuthCallback(req, res, next, requestId);
});

router.get('/login-failed', (req, res) => {
  res.status(401).send(
    '<h1>로그인에 실패했습니다.</h1><p>잠시 후 다시 시도하거나 관리자에게 문의해주세요.</p>'
  );
});

router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

export default router;
