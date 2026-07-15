import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, Collection } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import Strategy from 'passport-discord';
import { processPayment } from './utils/paymentProcessor.js';
import { checkAndGiveRole } from './utils/roleManager.js';
import { loadCommands } from './handlers/commandHandler.js';
import { loadEvents } from './handlers/eventHandler.js';

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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// View engine
app.set('view engine', 'ejs');
app.set('views', './src/dashboard/views');

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Passport
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
      update: {},
      create: {
        id: profile.id,
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

// Routes
import dashboardRouter from './dashboard/routes/index.js';
import authRouter from './dashboard/routes/auth.js';
import productsRouter from './dashboard/routes/products.js';
import settingsRouter from './dashboard/routes/settings.js';
import logsRouter from './dashboard/routes/logs.js';
import userDashRouter from './dashboard/routes/userDash.js';

app.use('/', dashboardRouter);
app.use('/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/logs', logsRouter);
app.use('/dashboard', userDashRouter);

// SMS Webhook endpoint
app.post('/webhook/sms', async (req, res) => {
  try {
    await processPayment(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('SMS webhook error:', error);
    res.status(500).send('Error');
  }
});

// Global function for sending DMs
global.sendUserDM = async (userId, options) => {
  try {
    const user = await client.users.fetch(userId);
    await user.send(options);
  } catch (error) {
    console.error('DM send error:', error);
  }
};

// Start server
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await prisma.$connect();
    console.log('Database connected');
    
    await loadCommands(client);
    await loadEvents(client);
    
    await client.login(process.env.DISCORD_BOT_TOKEN);
    console.log('Bot logged in');
    
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
  await prisma.$connect();
  process.exit();
});