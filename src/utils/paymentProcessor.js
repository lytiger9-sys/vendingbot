import { prisma } from '../index.js';
import { EmbedBuilder } from 'discord.js';

const processingLock = new Map();
const LOCK_TIMEOUT = 5000;

export async function processPayment(data) {
  const content = data.content || data.text || '';
  
  const amountMatch = content.match(/(\\d[\\d,]*)\\s*원이?\\s*입금/);
  if (!amountMatch) {
    console.log('Could not extract amount from:', content);
    return;
  }
  
  const amount = parseInt(amountMatch[1].replace(/,/g, ''));
  const senderMatch = content.match(/입금자[:\\s]*([가-힣a-zA-Z0-9*]+)/);
  const senderName = senderMatch ? senderMatch[1].trim() : '알 수 없음';
  
  console.log('Payment detected: ' + amount + '원 from ' + senderName);
  
  const pendingPayments = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      senderName: senderName,
      amount: amount
    },
    include: { user: true },
    orderBy: { createdAt: 'asc' }
  });
  
  if (pendingPayments.length === 0) {
    console.log('No matching pending payment found');
    return;
  }
  
  const payment = pendingPayments[0];
  
  if (processingLock.has(payment.id)) {
    console.log('Payment ' + payment.id + ' is already being processed');
    return;
  }
  
  processingLock.set(payment.id, true);
  setTimeout(() => processingLock.delete(payment.id), LOCK_TIMEOUT);
  
  try {
    const recentSameUser = await prisma.payment.findFirst({
      where: {
        userId: payment.userId,
        status: 'COMPLETED',
        createdAt: {
          gte: new Date(Date.now() - 60000)
        }
      }
    });
    
    if (recentSameUser && recentSameUser.amount === amount) {
      console.log('Duplicate payment detected, skipping');
      return;
    }
    
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'COMPLETED' }
    });
    
    await prisma.user.update({
      where: { id: payment.userId },
      data: {
        balance: payment.user.balance + payment.points
      }
    });
    
    console.log('Payment ' + payment.id + ' completed: +' + payment.points + ' to user ' + payment.userId);
    
    if (global.sendUserDM) {
      const embed = new EmbedBuilder()
        .setTitle('충전 완료')
        .setColor('#00FF00')
        .setDescription('\\' + amount.toLocaleString() + '원\\이 충전되었습니다.')
        .addFields(
          { name: '충전 금액', value: '\\' + payment.points.toLocaleString() + '원\\', inline: true },
          { name: '현재 잔액', value: '\\' + (payment.user.balance + payment.points).toLocaleString() + '원\\', inline: true }
        )
        .setTimestamp();
      await global.sendUserDM(payment.userId, { embeds: [embed] });
    }
  } catch (error) {
    console.error('Payment processing error:', error);
  }
}