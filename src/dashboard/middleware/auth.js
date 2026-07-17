export function isAuthenticated(req, res, next) {
  if (req.user) {
    return next();
  }
  res.redirect('/auth/discord');
}

export function isAdmin(req, res, next) {
  if (req.user && req.user.id === process.env.ADMIN_USER_ID) {
    return next();
  }
  // Admin이 아니면 일반 대시보드로 리다이렉트
  res.redirect('/');
}