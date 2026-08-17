import express from 'express';
import passport from 'passport';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();

router.get('/csrf', isAuthenticated, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

router.get('/discord', passport.authenticate('discord'));

router.get('/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/auth/login-failed' }),
  (req, res) => {
    res.redirect('/');
  }
);

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