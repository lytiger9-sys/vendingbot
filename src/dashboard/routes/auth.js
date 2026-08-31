import express from 'express';
import passport from 'passport';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();

router.get('/csrf', isAuthenticated, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

router.get('/discord', (req, res, next) => {
  // 이미 로그인된 사용자를 다시 Discord OAuth로 보내지 않아 리다이렉트 루프를 막습니다.
  if (req.user) return res.redirect('/');
  return passport.authenticate('discord')(req, res, next);
});

router.get('/discord/callback', (req, res, next) => {
  passport.authenticate('discord', (err, user) => {
    if (err) {
      console.error('OAuth callback error:', err.oauthError?.data || err.oauthError || err);
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