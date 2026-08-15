import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy } from 'passport-discord';
import { PrismaSessionStore } from './utils/prismaSessionStore.js';
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

client.commands = new Collection();
client.slashCommands = new Collection();

const app = express();

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
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

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
  scope: ['identify', 'guilds']
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

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await prisma.$connect();
    console.log('Database connected');

    await loadCommands(client);
    await loadEvents(client);

    await client.login(process.env.DISCORD_BOT_TOKEN);
    startPushbulletListener({ prisma, client });
    startPaymentExpiryScheduler(prisma);
    console.log('Bot logged in');

    app.locals.client = client;

    app.listen(PORT, () => {
      console.log('Server running on port ' + PORT);
    });
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
