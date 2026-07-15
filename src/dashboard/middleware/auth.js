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
  res.status(403).json({ error: 'Admin access required' });
}