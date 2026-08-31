import express from 'express';
import passport from 'passport';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();
let oauthBlockedUntil = 0;
const oauthRequestCooldown = new Map();
const oauthCallbackCooldown = new Map();
const OAUTH_REQUEST_COOLDOWN_MS = 15_000;

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
  return Number.isFinite(Number(retryAfter)) ? Math.ceil(Number(retryAfter)) : 300;
}

router.get('/csrf', isAuthenticated, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

router.get('/discord', (req, res, next) => {
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

  setOAuthCooldown(req);
  return passport.authenticate('discord')(req, res, next);
});

router.get('/discord/callback', (req, res, next) => {
  // callback URL을 새로고침해도 전역 제한 중에는 Discord에 재요청하지 않습니다.
  if (Date.now() < oauthBlockedUntil) {
    const retryAfter = Math.ceil((oauthBlockedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).send(`Discord OAuth가 일시적으로 차단되어 있습니다. ${retryAfter}초 후 다시 시도해주세요.`);
  }

  const callbackCooldownSeconds = isCallbackOnCooldown(req);
  if (callbackCooldownSeconds > 0) {
    res.set('Retry-After', String(callbackCooldownSeconds));
    return res.status(429).send(`로그인 callback이 중복 요청되었습니다. ${callbackCooldownSeconds}초 후 다시 시도해주세요.`);
  }

  oauthCallbackCooldown.set(getClientKey(req), Date.now() + OAUTH_REQUEST_COOLDOWN_MS);
  passport.authenticate('discord', (err, user) => {
    if (err) {
      console.error('OAuth callback error:', err.oauthError?.data || err.oauthError || err);
      if (isGlobalRateLimitError(err)) {
        const retryAfter = getRetryAfterSeconds(err);
        oauthBlockedUntil = Date.now() + retryAfter * 1000;
        res.set('Retry-After', String(retryAfter));
        return res.status(429).send(`Discord 로그인 요청이 일시적으로 제한되었습니다. ${retryAfter}초 후 다시 시도해주세요.`);
      }
      return res.status(502).send('Discord OAuth temporarily unavailable');
    }
    if (!user) return res.redirect('/auth/login-failed');

    req.logIn(user, (loginError) => {
      if (loginError) return next(loginError);
      return req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.redirect('/');
      });
    });
  })(req, res, next);
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