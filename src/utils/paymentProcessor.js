import { prisma } from '../index.js';
import { EmbedBuilder } from 'discord.js';

const processingLock = new Map();
const LOCK_TIMEOUT = 5000;

export async function processPayment(data) {
  const content = data.content || data.text || '';
  
  // 1. 문자열 내에서 금액 추출 (숫자와 원화 표시)
  const amountMatch = content.match(/(\d[\d,]*)\s*원/);
  if (!amountMatch) {
    console.log('❌ 금액을 추출할 수 없습니다:', content);
    return;
  }
  const amount = parseInt(amountMatch[1].replace(/,/g, ''));

  // 2. 현재 DB에 등록된 '동일한 금액'의 대기 중인 모든 신청 건(PENDING)들을 먼저 긁어옵니다.
  const pendingPaymentsForAmount = await prisma.payment.findMany({
    where: {
      status: 'PENDING',
      amount: amount
    },
    include: { user: true }
  });

  if (pendingPaymentsForAmount.length === 0) {
    console.log(`❌ [자동 충전 실패] ${amount.toLocaleString()}원 신청 건 자체가 존재하지 않습니다.`);
    return;
  }

  // 3. 문자열 내에 대기자 이름이 포함되어 있는지 교차 검증 (2중 보안 매칭)
  // 문장의 순서나 줄바꿈 위치에 상관없이, 알림 메시지 전체 본문 안에 유저가 신청한 이름이 적혀있는지 찾습니다.
  let matchedPayment = null;

  for (const payment of pendingPaymentsForAmount) {
    const trimmedSender = payment.senderName.trim();
    
    // 알림 메시지 텍스트 전체에 신청자 이름(예: "오정민")이 단어로 포함되어 있는지 검사
    if (content.includes(trimmedSender)) {
      matchedPayment = payment;
      break; 
    }
  }

  // 4. 만약 이름 검증까지 통과한 신청 건이 없다면 스킵
  if (!matchedPayment) {
    console.log(`❌ [자동 충전 실패] 금액(${amount.toLocaleString()}원)은 맞으나, 본문 내에서 일치하는 신청자 이름을 찾지 못했습니다.`);
    return;
  }

  const payment = matchedPayment;

  // 동시 처리 방지 락 (Lock)
  if (processingLock.has(payment.id)) return;
  processingLock.set(payment.id, true);
  setTimeout(() => processingLock.delete(payment.id), LOCK_TIMEOUT);

  try {
    // 중복 충전 방지 (최근 60초 내 완료 내역 체크)
    const recentSameUser = await prisma.payment.findFirst({
      where: {
        userId: payment.userId,
        status: 'COMPLETED',
        createdAt: { gte: new Date(Date.now() - 60000) }
      }
    });
    
    if (recentSameUser && recentSameUser.amount === amount) {
      console.log('⚠️ 중복 처리 감지되어 스킵합니다.');
      return;
    }

    // 트랜잭션 처리 (상태 변경 및 유저 잔액 추가)
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'COMPLETED' }
      }),
      prisma.user.update({
        where: { id: payment.userId },
        data: { balance: { increment: payment.points } }
      })
    ]);

    console.log(`✅ 자동 충전 완료: ${payment.senderName} 님 (+${payment.points.toLocaleString()}P)`);

    // 유저 DM 발송
    if (global.sendUserDM) {
      const embed = new EmbedBuilder()
        .setTitle('🏦 자동 충전 완료')
        .setColor('#00FF00')
        .setDescription('입금이 정상 확인되어 잔액이 자동 충전되었습니다.')
        .addFields(
          { name: '입금 확인된 이름', value: `\`${payment.senderName}\``, inline: true },
          { name: '충전 포인트', value: `\`+${payment.points.toLocaleString()}P\``, inline: true }
        )
        .setTimestamp();
      await global.sendUserDM(payment.userId, { embeds: [embed] });
    }

  } catch (error) {
    console.error('결제 승인 오류:', error);
  }
}