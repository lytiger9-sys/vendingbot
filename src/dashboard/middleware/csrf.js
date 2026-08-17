import crypto from 'node:crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getOrCreateToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function csrfToken(req, res, next) {
  const token = getOrCreateToken(req);
  req.csrfToken = () => token;
  res.locals.csrfToken = token;
  next();
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const expected = req.session?.csrfToken;
  const provided = req.get('x-csrf-token') || req.body?._csrf;

  if (!expected || !provided) {
    return res.status(403).json({ error: 'CSRF token is required.' });
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(String(provided), 'utf8');
  const valid = expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!valid) {
    return res.status(403).json({ error: 'Invalid CSRF token.' });
  }

  next();
}
