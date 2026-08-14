import session from 'express-session';

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function resolveExpiresAt(sessionData) {
  const cookie = sessionData?.cookie;

  if (cookie?.expires) {
    const expiresAt = new Date(cookie.expires);
    if (!Number.isNaN(expiresAt.getTime())) {
      return expiresAt;
    }
  }

  if (typeof cookie?.originalMaxAge === 'number') {
    return new Date(Date.now() + cookie.originalMaxAge);
  }

  return new Date(Date.now() + DEFAULT_SESSION_TTL_MS);
}

function safeParseSession(data) {
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

export class PrismaSessionStore extends session.Store {
  constructor(prisma) {
    super();
    this.prisma = prisma;
  }

  async get(sid, callback) {
    try {
      const record = await this.prisma.session.findUnique({
        where: { sid }
      });

      if (!record) {
        return callback?.(null, null);
      }

      if (record.expiresAt <= new Date()) {
        await this.prisma.session.deleteMany({ where: { sid } }).catch(() => {});
        return callback?.(null, null);
      }

      const sessionData = safeParseSession(record.data);
      return callback?.(null, sessionData);
    } catch (error) {
      return callback?.(error);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const expiresAt = resolveExpiresAt(sessionData);
      const data = JSON.stringify(sessionData);

      await this.prisma.session.upsert({
        where: { sid },
        update: { data, expiresAt },
        create: { sid, data, expiresAt }
      });

      return callback?.(null);
    } catch (error) {
      return callback?.(error);
    }
  }

  async destroy(sid, callback) {
    try {
      await this.prisma.session.deleteMany({ where: { sid } });
      return callback?.(null);
    } catch (error) {
      return callback?.(error);
    }
  }

  async touch(sid, sessionData, callback) {
    return this.set(sid, sessionData, callback);
  }

  async length(callback) {
    try {
      const count = await this.prisma.session.count({
        where: { expiresAt: { gt: new Date() } }
      });
      return callback?.(null, count);
    } catch (error) {
      return callback?.(error);
    }
  }

  async clear(callback) {
    try {
      await this.prisma.session.deleteMany({});
      return callback?.(null);
    } catch (error) {
      return callback?.(error);
    }
  }
}
