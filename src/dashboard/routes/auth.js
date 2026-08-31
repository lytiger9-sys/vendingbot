import express from 'express';
import passport from 'passport';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();
let oauthBlockedUntil = 0;

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

  if (Date.now() < oauthBlockedUntil) {
    const retryAfter = Math.ceil((oauthBlockedUntil - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).send(`Discord 로그인 요청이 일시적으로 제한되었습니다. ${retryAfter}초 후 다시 시도해주세요.`);
  }

  return passport.authenticate('discord')(req, res, next);
});

router.get('/discord/callback', (req, res, next) => {
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