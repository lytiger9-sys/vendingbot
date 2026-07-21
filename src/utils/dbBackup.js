import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../prisma/dev.db');
const BACKUP_PATH = join(__dirname, '../../prisma/dev_backup.db');

export function setupBackupScheduler(client) {
  // 한국시간(KST) 자정(00:00)에 실행 - UTC 15:00
  cron.schedule('0 15 * * *', async () => {
    console.log('🕛 [DB 백업] 자정 백업 시작...');
    await performBackup(client);
  }, {
    timezone: 'Asia/Seoul'
  });
  
  console.log('✅ DB 자동 백업 스케줄러 설정 완료 (매일 자정 KST)');
}

export async function checkAndRestoreFromBackup(client, prisma) {
  try {
    const backupChannelId = process.env.DB_BACKUP_CHANNEL_ID;
    if (!backupChannelId) {
      console.log('⚠️ DB 백업 채널이 설정되지 않았습니다.');
      return false;
    }

    const channel = await client.channels.fetch(backupChannelId).catch(() => null);
    if (!channel) {
      console.log('⚠️ 백업 채널을 찾을 수 없습니다.');
      return false;
    }

    // 채널 메시지 불러오기 (가장 최근 100개)
    const messages = await channel.messages.fetch({ limit: 100 });
    
    // .db 파일이 첨부된 가장 최근 메시지 찾기
    const dbMessage = messages.find(msg => 
      msg.attachments && 
      msg.attachments.size > 0 && 
      msg.attachments.some(att => att.name.endsWith('.db'))
    );

    if (!dbMessage) {
      console.log('ℹ️ 백업 채널에서 DB 파일을 찾지 못했습니다. 기존 DB를 사용합니다.');
      return false;
    }

    const dbAttachment = dbMessage.attachments.find(att => att.name.endsWith('.db'));
    if (!dbAttachment) {
      return false;
    }

    console.log(`📥 DB 복원 시도: ${dbAttachment.name}`);

    // 기존 DB 백업 (보험용)
    if (existsSync(DB_PATH)) {
      const emergencyBackup = `${DB_PATH}.emergency_${Date.now()}.db`;
      copyFileSync(DB_PATH, emergencyBackup);
      console.log(`🛡️ 기존 DB 백업 완료: ${emergencyBackup}`);
    }

    // 새 DB 파일 다운로드 및 저장
    const response = await axios.get(dbAttachment.url, { responseType: 'arraybuffer' });
    writeFileSync(DB_PATH, Buffer.from(response.data));

    // Prisma 재연결
    await prisma.$disconnect();
    await prisma.$connect();

    const restoreTime = new Date(dbMessage.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`✅ DB 복원 완료! (백업 일시: ${restoreTime})`);
    
    // 복원 완료 알림
    try {
      const devUser = await client.users.fetch(process.env.DEV_USER_ID || '000000000000000000');
      if (devUser.id !== '000000000000000000') {
        const embed = new EmbedBuilder()
          .setTitle('✅ DB 자동 복원 완료')
          .setColor('#00FF00')
          .setDescription('시작 시 최신 백업으로 DB가 복원되었습니다.')
          .addFields(
            { name: '복원된 파일', value: dbAttachment.name, inline: true },
            { name: '백업 일시', value: restoreTime, inline: true }
          )
          .setTimestamp();

        await devUser.send({ embeds: [embed] });
      }
    } catch (e) {}

    return true;

  } catch (error) {
    console.error('❌ DB 복원 실패:', error);
    return false;
  }
}

export async function performBackup(client) {
  try {
    const backupChannelId = process.env.DB_BACKUP_CHANNEL_ID;
    if (!backupChannelId) {
      console.log('⚠️ DB 백업 채널이 설정되지 않았습니다.');
      return;
    }

    // DB 파일 존재 확인
    if (!existsSync(DB_PATH)) {
      console.log('⚠️ 백업할 DB 파일이 존재하지 않습니다.');
      return;
    }

    // 백업 파일 생성
    const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const backupFileName = `vending_bot_db_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.db`;
    const tempBackupPath = join(__dirname, `../../prisma/${backupFileName}`);
    
    copyFileSync(DB_PATH, tempBackupPath);

    // 디코드 채널로 파일 전송
    const channel = await client.channels.fetch(backupChannelId).catch(() => null);
    if (!channel) {
      console.log('⚠️ 백업 채널을 찾을 수 없습니다.');
      return;
    }

    const backupFile = new AttachmentBuilder(tempBackupPath);
    const embed = new EmbedBuilder()
      .setTitle('💾 데이터베이스 백업')
      .setColor('#00FF00')
      .setDescription(`**${timestamp}** 기준 자동 백업입니다.`)
      .addFields(
        { name: '백업 일시', value: timestamp, inline: true },
        { name: '파일명', value: backupFileName, inline: true }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed], files: [backupFile] });
    console.log(`✅ DB 백업 완료: ${backupFileName}`);

    // 임시 백업 파일 삭제
    const { unlinkSync } = await import('fs');
    try { unlinkSync(tempBackupPath); } catch (e) {}

  } catch (error) {
    console.error('❌ DB 백업 실패:', error);
  }
}

export async function restoreFromBackup(message) {
  try {
    // 메시지에서 첨부파일 확인
    if (!message.attachments || message.attachments.size === 0) {
      return { success: false, message: '첨부된 파일이 없습니다.' };
    }

    const attachment = message.attachments.first();
    if (!attachment.name.endsWith('.db')) {
      return { success: false, message: 'DB 파일(.db)이 아닙니다.' };
    }

    // 기존 DB 백업
    if (existsSync(DB_PATH)) {
      const emergencyBackup = `${DB_PATH}.emergency_${Date.now()}.db`;
      copyFileSync(DB_PATH, emergencyBackup);
      console.log(`🛡️ 기존 DB 백업 완료: ${emergencyBackup}`);
    }

    // 새 DB 파일 다운로드 및 저장
    const { default: axios } = await import('axios');
    const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
    writeFileSync(DB_PATH, Buffer.from(response.data));

    // Prisma 재연결
    const { prisma } = await import('../index.js');
    await prisma.$disconnect();
    await prisma.$connect();

    return { 
      success: true, 
      message: `✅ DB가 성공적으로 복원되었습니다!\n📁 파일: ${attachment.name}`
    };

  } catch (error) {
    console.error('❌ DB 복원 실패:', error);
    return { success: false, message: `❌ 복원 실패: ${error.message}` };
  }
}
