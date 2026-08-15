import { EmbedBuilder } from 'discord.js';
import { upsertChargeLog } from './paymentLogger.js';
import {
  extractDepositAmount,
  getAutoChargeWindowCutoff,
  matchesSenderName,
} from './autoChargeMatcher.js';

function formatAmount(value) {
  return Number(value || 0).toLocaleString('ko-KR');
}

async function expireStalePendingPayments(prisma, amount, cutoff) {
  const result = await prisma.payment.updateMany({
    where: {
      type: 'AUTO',
      status: 'PENDING',
      amount,
      createdAt: { lt: cutoff },
    },
    data: {
      status: 'EXPIRED',
      expired: true,
    },
  });

  return result.count;
}

async function completeAutoCharge(prisma, candidate, cutoff) {
  return prisma.$transaction(async (tx) => {
    const claimResult = await tx.payment.updateMany({
      where: {
        id: candidate.id,
        userId: candidate.userId,
        type: 'AUTO',
        status: 'PENDING',
        amount: candidate.amount,
        createdAt: { gte: cutoff },
      },
      data: {
        status: 'COMPLETED',
      },
    });

    if (claimResult.count !== 1) {
      return null;
    }

    await tx.user.update({
      where: { id: candidate.userId },
      data: {
        balance: { increment: candidate.points },
      },
    });

    return {
      ...candidate,
      status: 'COMPLETED',
      updatedAt: new Date(),
    };
  });
}

function sendAutoChargeDm(payment) {
  if (typeof global.sendUserDM !== 'function') {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('자동충전 완료')
    .setColor('#00FF00')
    .setDescription('입금이 정상 확인되어 자동충전이 완료되었습니다.')
    .addFields(
      { name: '입금자명', value: `\`${payment.senderName}\``, inline: true },
      { name: '충전 포인트', value: `\`+${formatAmount(payment.points)}P\``, inline: true },
    )
    .setTimestamp();

  return global.sendUserDM(payment.userId, { embeds: [embed] });
}

export async function processPayment(data, deps = {}) {
  const prisma = deps.prisma;
  const client = deps.client;

  if (!prisma) {
    throw new Error('processPayment requires a prisma instance');
  }

  const fallbackContent = [data?.title, data?.body]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const content = String(data?.content ?? data?.text ?? fallbackContent ?? '');
  const amount = extractDepositAmount(content);

  if (amount === null) {
    console.log('[auto-charge] no amount found in webhook payload');
    return null;
  }

  const minDepositSetting = await prisma.systemSetting.findUnique({
    where: { key: 'MIN_DEPOSIT' },
  });

  const parsedMinAmount = Number.parseInt(minDepositSetting?.value ?? '', 10);
  const minAmount = Number.isNaN(parsedMinAmount) ? 1000 : parsedMinAmount;

  if (amount < minAmount) {
    console.log(
      `[auto-charge] amount below minimum: ${formatAmount(amount)}원 < ${formatAmount(minAmount)}원`
    );
    return null;
  }

  const cutoff = getAutoChargeWindowCutoff();

  try {
    const expiredCount = await expireStalePendingPayments(prisma, amount, cutoff);
    if (expiredCount > 0) {
      console.log(`[auto-charge] expired ${expiredCount} stale request(s) for amount ${formatAmount(amount)}원`);
    }
  } catch (error) {
    console.error('[auto-charge] failed to expire stale requests:', error);
  }

  const pendingPayments = await prisma.payment.findMany({
    where: {
      type: 'AUTO',
      status: 'PENDING',
      amount,
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (pendingPayments.length === 0) {
    console.log(`[auto-charge] no eligible pending requests found for ${formatAmount(amount)}원`);
    return null;
  }

  let matchedByName = false;

  for (const candidate of pendingPayments) {
    if (!matchesSenderName(content, candidate.senderName)) {
      continue;
    }

    matchedByName = true;

    try {
      const completedPayment = await completeAutoCharge(prisma, candidate, cutoff);
      if (!completedPayment) {
        continue;
      }

      console.log(
        `[auto-charge] completed: ${completedPayment.senderName} (+${formatAmount(completedPayment.points)}P)`
      );

      await upsertChargeLog(client, prisma, completedPayment);
      await sendAutoChargeDm(completedPayment);

      return completedPayment;
    } catch (error) {
      console.error(`[auto-charge] failed to complete payment ${candidate.id}:`, error);
    }
  }

  if (matchedByName) {
    console.log(
      `[auto-charge] sender name matched, but payment could not be claimed for ${formatAmount(amount)}원`
    );
  } else {
    console.log(
      `[auto-charge] no sender-name match among recent pending requests for ${formatAmount(amount)}원`
    );
  }

  return null;
}
