import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import cron from 'node-cron';
import { mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDbBackupChannelId } from './runtimeConfig.js';

const BACKUP_DIR = join(tmpdir(), 'hami-shop-backups');

mkdirSync(BACKUP_DIR, { recursive: true });

function toDate(value) {
  if (value === null || value === undefined || value === '') {
    return value;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

function normalizeUser(user) {
  return {
    ...user,
    lastDaily: toDate(user.lastDaily)
  };
}

function normalizeProduct(product) {
  return { ...product };
}

function normalizeStock(stock) {
  return { ...stock };
}

function normalizePayment(payment) {
  const { updatedAt, ...rest } = payment;
  return {
    ...rest,
    createdAt: toDate(payment.createdAt)
  };
}

function normalizeReceipt(receipt) {
  return {
    ...receipt,
    purchasedAt: toDate(receipt.purchasedAt)
  };
}

function normalizeSession(session) {
  const { updatedAt, ...rest } = session;
  return {
    ...rest,
    createdAt: toDate(session.createdAt),
    expiresAt: toDate(session.expiresAt)
  };
}

async function hasExistingData(prisma) {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.category.count(),
    prisma.product.count(),
    prisma.stock.count(),
    prisma.payment.count(),
    prisma.receipt.count(),
    prisma.roleReward.count(),
    prisma.systemSetting.count(),
    prisma.embedSetting.count(),
    prisma.session.count()
  ]);

  return counts.some(count => count > 0);
}

async function collectBackupData(prisma) {
  const [
    users,
    categories,
    products,
    stocks,
    payments,
    receipts,
    roleRewards,
    systemSettings,
    embedSettings,
    sessions
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.category.findMany(),
    prisma.product.findMany(),
    prisma.stock.findMany(),
    prisma.payment.findMany(),
    prisma.receipt.findMany(),
    prisma.roleReward.findMany(),
    prisma.systemSetting.findMany(),
    prisma.embedSetting.findMany(),
    prisma.session.findMany()
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    collections: {
      users,
      categories,
      products,
      stocks,
      payments,
      receipts,
      roleRewards,
      systemSettings,
      embedSettings,
      sessions
    }
  };
}

async function writeMongoBackup(prisma) {
  const backupData = await collectBackupData(prisma);
  const backupFileName = `mongo_backup_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
  const backupPath = join(BACKUP_DIR, backupFileName);

  writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');

  return { backupFileName, backupPath };
}

async function restoreMongoBackup(prisma, payload) {
  const data = payload?.collections ?? payload;

  if (!data) {
    throw new Error('Invalid backup payload');
  }

  await prisma.$transaction(async (tx) => {
    await tx.receipt.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.stock.deleteMany({});
    await tx.product.deleteMany({});
    await tx.category.deleteMany({});
    await tx.roleReward.deleteMany({});
    await tx.embedSetting.deleteMany({});
    await tx.systemSetting.deleteMany({});
    await tx.session.deleteMany({});
    await tx.user.deleteMany({});

    for (const user of data.users || []) {
      await tx.user.create({ data: normalizeUser(user) });
    }

    for (const category of data.categories || []) {
      await tx.category.create({ data: category });
    }

    for (const roleReward of data.roleRewards || []) {
      await tx.roleReward.create({ data: roleReward });
    }

    for (const setting of data.systemSettings || []) {
      await tx.systemSetting.create({ data: setting });
    }

    for (const embedSetting of data.embedSettings || []) {
      await tx.embedSetting.create({ data: embedSetting });
    }

    for (const product of data.products || []) {
      await tx.product.create({ data: normalizeProduct(product) });
    }

    for (const stock of data.stocks || []) {
      await tx.stock.create({ data: normalizeStock(stock) });
    }

    for (const payment of data.payments || []) {
      await tx.payment.create({ data: normalizePayment(payment) });
    }

    for (const receipt of data.receipts || []) {
      await tx.receipt.create({ data: normalizeReceipt(receipt) });
    }

    for (const session of data.sessions || []) {
      await tx.session.create({ data: normalizeSession(session) });
    }
  });
}

async function fetchLatestBackupAttachment(client) {
  const backupChannelId = getDbBackupChannelId();
  if (!backupChannelId) {
    console.log('DB 백업 채널이 설정되지 않았습니다. (DB_BACKUP_CHANNEL_ID / DB_Backup_Channel_ID)');
    return null;
  }

  const channel = await client.channels.fetch(backupChannelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== 'function') {
    console.log('DB 백업 채널을 찾을 수 없습니다.');
    return null;
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const backupMessage = messages.find(msg =>
    msg.attachments?.size > 0 &&
    msg.attachments.some(att => att.name?.endsWith('.json'))
  );

  if (!backupMessage) {
    console.log('DB 백업 파일을 찾지 못했습니다. 기존 데이터를 유지합니다.');
    return null;
  }

  const attachment = backupMessage.attachments.find(att => att.name.endsWith('.json'));
  return attachment ? { attachment, backupMessage } : null;
}

export function setupBackupScheduler(client, prisma) {
  cron.schedule('0 15 * * *', async () => {
    console.log('[DB 백업] 정기 백업 시작...');
    await performBackup(client, prisma);
  }, {
    timezone: 'Asia/Seoul'
  });

  console.log('DB 자동 백업 스케줄러 설정 완료 (매일 KST 00:00)');
}

export async function checkAndRestoreFromBackup(client, prisma) {
  try {
    if (await hasExistingData(prisma)) {
      console.log('DB에 기존 데이터가 있어 자동 복원을 건너뜁니다.');
      return false;
    }

    const result = await fetchLatestBackupAttachment(client);
    if (!result) {
      return false;
    }

    const response = await axios.get(result.attachment.url, { responseType: 'arraybuffer' });
    const payload = JSON.parse(Buffer.from(response.data).toString('utf8'));

    await restoreMongoBackup(prisma, payload);

    const restoreTime = new Date(result.backupMessage.createdAt).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul'
    });
    console.log(`DB 복원 완료 (백업 시각: ${restoreTime})`);

    try {
      const devUserId = process.env.DEV_USER_ID;
      if (devUserId) {
        const devUser = await client.users.fetch(devUserId).catch(() => null);
        if (devUser) {
          const embed = new EmbedBuilder()
            .setTitle('DB 자동 복원 완료')
            .setColor('#00FF00')
            .setDescription('최근 백업 파일로 DB를 복원했습니다.')
            .addFields(
              { name: '복원 파일', value: result.attachment.name, inline: true },
              { name: '백업 시각', value: restoreTime, inline: true }
            )
            .setTimestamp();

          await devUser.send({ embeds: [embed] });
        }
      }
    } catch (error) {
      console.error('복원 알림 DM 전송 실패:', error);
    }

    return true;
  } catch (error) {
    console.error('DB 복원 실패:', error);
    return false;
  }
}

export async function performBackup(client, prisma) {
  try {
    const backupChannelId = getDbBackupChannelId();
    if (!backupChannelId) {
      console.log('DB 백업 채널이 설정되지 않았습니다. (DB_BACKUP_CHANNEL_ID / DB_Backup_Channel_ID)');
      return false;
    }

    const channel = await client.channels.fetch(backupChannelId).catch(() => null);
    if (!channel || typeof channel.send !== 'function') {
      console.log('DB 백업 채널을 찾을 수 없습니다.');
      return false;
    }

    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const { backupFileName, backupPath } = await writeMongoBackup(prisma);
    const backupFile = new AttachmentBuilder(backupPath);

    const embed = new EmbedBuilder()
      .setTitle('MongoDB 백업')
      .setColor('#00FF00')
      .setDescription(`**${timestamp}** 기준으로 DB 백업을 생성했습니다.`)
      .addFields(
        { name: '백업 시각', value: timestamp, inline: true },
        { name: '파일명', value: backupFileName, inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed], files: [backupFile] });
    console.log(`DB 백업 완료: ${backupFileName}`);

    try {
      unlinkSync(backupPath);
    } catch (error) {}

    return true;
  } catch (error) {
    console.error('DB 백업 실패:', error);
    return false;
  }
}

export async function restoreFromBackup(message, prisma) {
  try {
    if (!message.attachments || message.attachments.size === 0) {
      return { success: false, message: '첨부 파일이 없습니다.' };
    }

    const attachment = message.attachments.first();
    if (!attachment?.name?.endsWith('.json')) {
      return { success: false, message: 'MongoDB 백업 파일(.json)이 아닙니다.' };
    }

    const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
    const payload = JSON.parse(Buffer.from(response.data).toString('utf8'));
    await restoreMongoBackup(prisma, payload);

    return {
      success: true,
      message: `DB 복원이 완료되었습니다.\n파일: ${attachment.name}`
    };
  } catch (error) {
    console.error('DB 복원 실패:', error);
    return { success: false, message: `복원 실패: ${error.message}` };
  }
}
