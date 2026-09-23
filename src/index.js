import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy } from 'passport-discord';
import { PrismaSessionStore } from './utils/prismaSessionStore.js';
import { csrfProtection, csrfToken } from './dashboard/middleware/csrf.js';
import { startPushbulletListener } from './utils/pushbulletListener.js';
import { startPaymentExpiryScheduler, stopPaymentExpiryScheduler } from './utils/paymentExpiryScheduler.js';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

export const prisma = new PrismaClient();

client.on('error', (error) => {
  console.error('[discord client error]', {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });
});

client.on('shardError', (error, shardId) => {
  console.error('[discord shard error]', {
    shardId,
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });
});

client.on('shardDisconnect', (closeEvent, shardId) => {
  console.error('[discord shard disconnect]', {
    shardId,
    code: closeEvent?.code,
    reason: closeEvent?.reason?.toString?.() || String(closeEvent?.reason || ''),
  });
});

client.on('debug', (message) => {
  if (/identify|ready|session|gateway|4013|4014|429/i.test(message)) {
    console.log('[discord gateway debug]', message);
  }
});

client.commands = new Collection();
client.slashCommands = new Collection();

const app = express();

if (process.env.NODE_ENV === 'production') {
  // HTTPS를 프록시가 종료하는 배포 환경에서도 secure 세션 쿠키를 정상 처리합니다.
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', './src/dashboard/views');

app.use('/css', express.static('./src/dashboard/public/css'));
app.use('/js', express.static('./src/dashboard/public/js'));
app.use(express.static('./src/dashboard/public'));

app.use(session({
  store: new PrismaSessionStore(prisma),
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use(csrfToken);
app.use(csrfProtection);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser(async (obj, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: obj.id } });
    done(null, user || obj);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new Strategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: process.env.REDIRECT_URI,
  scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await prisma.user.upsert({
      where: { id: profile.id },
      update: { username: profile.username, avatar: profile.avatar },
      create: {
        id: profile.id,
        username: profile.username,
        avatar: profile.avatar,
        balance: 0,
        totalSpent: 0,
        blacklisted: false
      }
    });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

import dashboardRouter from './dashboard/routes/index.js';
import authRouter from './dashboard/routes/auth.js';
import productsRouter from './dashboard/routes/products.js';
import settingsRouter from './dashboard/routes/settings.js';
import logsRouter from './dashboard/routes/logs.js';
import userDashRouter from './dashboard/routes/userDash.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';

app.use('/', dashboardRouter);
app.use('/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);
app.use('/dashboard', userDashRouter);

global.sendUserDM = async (userId, options) => {
  try {
    const user = await client.users.fetch(userId);
    await user.send(options);
  } catch (error) {
    console.error('DM send error:', error);
  }
};

const PORT = Number.parseInt(process.env.PORT || '10000', 10) || 10000;
const DISCORD_LOGIN_TIMEOUT_MS = 45_000;
const DISCORD_RETRY_BASE_MS = 60_000;
const DISCORD_RETRY_MAX_MS = 900_000;
const DISCORD_RATE_LIMIT_MIN_RETRY_MS = 300_000;
const DISCORD_RETRY_JITTER_RATIO = 0.2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getErrorStatus(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || 0);
}

function getErrorMessage(error) {
  return String(error?.message || error?.response?.data?.message || '');
}

function isRateLimitError(error) {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error).toLowerCase();
  return status === 429 || message.includes('rate limit') || message.includes('temporarily');
}

function getRetryAfterMs(error) {
  const retryAfter = error?.retryAfter ?? error?.retry_after ?? error?.response?.data?.retry_after;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null;
}

function addRetryJitter(delayMs) {
  const jitter = delayMs * DISCORD_RETRY_JITTER_RATIO;
  return Math.max(1_000, Math.round(delayMs + ((Math.random() * 2 - 1) * jitter)));
}

function getRetryDelayMs(error, attempt) {
  const retryAfterMs = getRetryAfterMs(error);
  if (retryAfterMs !== null) {
    return Math.min(
      DISCORD_RETRY_MAX_MS,
      Math.max(DISCORD_RATE_LIMIT_MIN_RETRY_MS, retryAfterMs),
    );
  }

  const exponentialDelay = Math.min(
    DISCORD_RETRY_MAX_MS,
    DISCORD_RETRY_BASE_MS * (2 ** Math.min(attempt, 4)),
  );
  const minimumDelay = isRateLimitError(error) ? DISCORD_RATE_LIMIT_MIN_RETRY_MS : 0;
  return Math.max(minimumDelay, addRetryJitter(exponentialDelay));
}

async function loginDiscordWithTimeout() {
  let timeout;
  let loginPromise;

  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Discord Gateway login timed out after ${DISCORD_LOGIN_TIMEOUT_MS / 1000} seconds`));
    }, DISCORD_LOGIN_TIMEOUT_MS);
  });

  try {
    // Promise.race() cannot cancel client.login(). Keep the login promise
    // alive until it settles so the retry loop cannot overlap Gateway logins.
    loginPromise = client.login(process.env.DISCORD_BOT_TOKEN);
    return await Promise.race([
      loginPromise,
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
    if (loginPromise) {
      await Promise.race([
        loginPromise.catch(() => undefined),
        sleep(5_000),
      ]);
    }
  }
}

let discordConnectPromise = null;

async function connectDiscord() {
  if (discordConnectPromise) {
    return discordConnectPromise;
  }

  discordConnectPromise = (async () => {
  let attempt = 0;

  while (true) {
    try {
      console.log(`[discord login] connecting to Gateway (attempt ${attempt + 1})...`);
      await loginDiscordWithTimeout();
      startPushbulletListener({ prisma, client });
      startPaymentExpiryScheduler(prisma, client);
      app.locals.client = client;
      console.log('Bot logged in');
      console.log('Bot services initialized');
      return;
    } catch (error) {
      console.error('[discord login failed]', {
        attempt: attempt + 1,
        name: error?.name,
        code: error?.code,
        status: getErrorStatus(error),
        rateLimited: isRateLimitError(error),
        retryAfterMs: getRetryAfterMs(error),
        message: error?.message,
      });

      try {
        client.destroy();
      } catch (destroyError) {
        console.error('[discord destroy failed]', destroyError);
      }

      const retryDelay = getRetryDelayMs(error, attempt);
      console.log(
        `[discord login] ${isRateLimitError(error) ? 'rate limit detected; ' : ''}` +
        `retrying in ${Math.ceil(retryDelay / 1000)}s...`,
      );
      attempt += 1;
      await sleep(retryDelay);
    }
  }
  })();

  return discordConnectPromise;
}

async function start() {
  // Render가 외부 서비스 초기화 전에 포트를 감지할 수 있도록 서버를 먼저 엽니다.
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Server listening on port ' + PORT);
  });

  try {
    await prisma.$connect();
    console.log('Database connected');

    await loadCommands(client);
    await loadEvents(client);

    if (!process.env.DISCORD_BOT_TOKEN) {
      throw new Error('DISCORD_BOT_TOKEN is not configured');
    }

    // 웹 서버는 유지하고 Discord Gateway만 실패 시 자동 재연결합니다.
    void connectDiscord();
  } catch (error) {
    console.error('Failed to start web/database initialization:', error);
    process.exit(1);
  }
}

start();

process.on('SIGINT', async () => {
  try {
    stopPaymentExpiryScheduler(); 
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
});
