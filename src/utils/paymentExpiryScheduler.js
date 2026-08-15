import { getAutoChargeWindowCutoff } from './autoChargeMatcher.js';

const DEFAULT_CHECK_INTERVAL_MS = 60 * 1000; // 1분마다 체크

let intervalHandle = null;

/**
 * 금액에 상관없이, 5분(AUTO_CHARGE_WINDOW_MS)이 지난 모든 PENDING/AUTO 건을
 * EXPIRED로 일괄 전환한다. paymentProcessor.js의 expireStalePendingPayments와 달리
 * 특정 amount에 한정하지 않고 전체를 스캔한다.
 */
async function expireAllStalePendingPayments(prisma) {
  const cutoff = getAutoChargeWindowCutoff();

  // 만료 대상 조회 (만료 후 유저에게 안내하기 위해 먼저 조회)
  const staleCandidates = await prisma.payment.findMany({
    where: {
      type: 'AUTO',
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    select: { id: true, userId: true, amount: true, senderName: true },
  });

  if (staleCandidates.length === 0) {
    return 0;
  }

  const result = await prisma.payment.updateMany({
    where: {
      type: 'AUTO',
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    data: {
      status: 'EXPIRED',
      expired: true,
    },
  });

  console.log(`[auto-charge-expiry] expired ${result.count} stale pending request(s)`);

  // 유저에게 만료 안내 DM (실패해도 전체 흐름에 영향 없도록 개별 try/catch)
  if (typeof global.sendUserDM === 'function') {
    for (const payment of staleCandidates) {
      try {
        await global.sendUserDM(payment.userId, {
          content:
            `⏰ 자동충전 신청이 시간 만료(5분)되어 취소되었습니다.\n` +
            `- 입금자명: ${payment.senderName}\n` +
            `- 신청 금액: ${Number(payment.amount).toLocaleString('ko-KR')}원\n` +
            `이미 입금하셨다면 관리자에게 문의해 주세요.`,
        });
      } catch (error) {
        console.error(`[auto-charge-expiry] failed to notify user ${payment.userId}:`, error);
      }
    }
  }

  return result.count;
}

/**
 * 주기적으로(기본 1분마다) 만료된 PENDING/AUTO 결제 신청을 정리한다.
 * index.js의 start() 안에서 한 번만 호출하면 된다.
 */
export function startPaymentExpiryScheduler(prisma, intervalMs = DEFAULT_CHECK_INTERVAL_MS) {
  if (intervalHandle) {
    return intervalHandle; // 중복 시작 방지
  }

  // 서버 기동 직후 한 번 즉시 정리
  expireAllStalePendingPayments(prisma).catch((error) => {
    console.error('[auto-charge-expiry] initial cleanup failed:', error);
  });

  intervalHandle = setInterval(() => {
    expireAllStalePendingPayments(prisma).catch((error) => {
      console.error('[auto-charge-expiry] periodic cleanup failed:', error);
    });
  }, intervalMs);

  console.log(`[auto-charge-expiry] scheduler started (interval: ${intervalMs / 1000}s)`);

  return intervalHandle;
}

export function stopPaymentExpiryScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}