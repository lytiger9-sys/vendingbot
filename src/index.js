const envKeys = [
  'ADMIN_USER_ID',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'DASHBOARD_URL',
  'DB_Backup_Channel_ID',
  'DISCORD_BOT_TOKEN',
  'REDIRECT_URI',
  'SERVER_ID',
  'SESSION_SECRET',
  'WEBHOOK_SECRET'
];

// 2. 환경변수 체크 및 출력
console.log('\n========================================');
console.log('🔍 [환경변수 로드 상태 전체 점검]');
console.log('========================================');

let missingCount = 0;

envKeys.forEach((key) => {
  const value = process.env[key];
  if (value && value.trim() !== '') {
    // 보안을 위해 앞 3자리만 출력하고 나머지는 마스킹 처리
    const maskedValue = value.length > 5 
      ? `${value.substring(0, 3)}***` 
      : '***';
    console.log(`✅ ${key.padEnd(22)} : 로드 완료 (${maskedValue})`);
  } else {
    console.log(`❌ ${key.padEnd(22)} : undefined (없음)`);
    missingCount++;
  }
});

console.log('========================================');
if (missingCount === 0) {
  console.log('🎉 모든 환경변수가 정상적으로 로드되었습니다!');
} else {
  console.log(`⚠️ 총 ${missingCount}개의 환경변수를 찾을 수 없습니다. Render 대시보드를 확인하세요.`);
}
console.log('========================================\n');

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

// Static files
app.use('/css', express.static('./src/dashboard/public/css'));
app.use('/js', express.static('./src/dashboard/public/js'));
app.use(express.static('./src/dashboard/public'));
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

// SMS Webhook endpoint (시크릿 키 인증 필요)
app.post('/webhook/sms', async (req, res) => {
  try {
    const providedSecret = req.get('x-webhook-secret') || req.query.secret;
    const expectedSecret = process.env.WEBHOOK_SECRET;

    if (!expectedSecret) {
      console.error('WEBHOOK_SECRET이 .env에 설정되어 있지 않습니다. 요청을 거부합니다.');
      return res.status(500).send('Server misconfigured');
    }

    if (!providedSecret || providedSecret !== expectedSecret) {
      console.warn('SMS 웹훅 인증 실패 (잘못된 시크릿 키):', req.ip);
      return res.status(401).send('Unauthorized');
    }

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
    
    // Discord client를 app.locals에 할당 (API 라우트에서 사용)
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
  await prisma.$connect();
  process.exit();
});