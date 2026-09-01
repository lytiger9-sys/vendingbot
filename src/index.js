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

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;

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

    const loginTimeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Discord Gateway login timed out after 45 seconds'));
      }, 45_000);
    });

    console.log('[discord login] connecting to Gateway...');
    await Promise.race([
      client.login(process.env.DISCORD_BOT_TOKEN),
      loginTimeout,
    ]);
    startPushbulletListener({ prisma, client });
    startPaymentExpiryScheduler(prisma, client);
    console.log('Bot logged in');

    app.locals.client = client;
    console.log('Bot services initialized');
  } catch (error) {
    console.error('Failed to start:', error);
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
