import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

function getApplicationId() {
  return process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || '';
}

/**
 * interaction.token으로 원본 ephemeral 응답(@original)을 수정한다.
 * interaction.token은 최초 응답 후 15분간만 유효하다.
 * (자동충전 5분 윈도우 안에서는 항상 유효함)
 */
async function patchOriginalReply(interactionToken, payload) {
  const applicationId = getApplicationId();
  if (!applicationId || !interactionToken) {
    return false;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      // 15분이 지났거나, 유저가 메시지를 직접 지운 경우 등은 조용히 무시
      // (DM이 최종 안내 수단이므로 여기서 실패해도 치명적이지 않음)
      const errText = await response.text().catch(() => '');
      console.warn(`[deposit-reply] failed to edit original reply (${response.status}): ${errText}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[deposit-reply] error editing original reply:', error);
    return false;
  }
}

export async function markDepositReplyCompleted(payment) {
  const container = new ContainerBuilder()
    .setAccentColor(0x2ECC71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ✅ 입금 완료\n\n` +
        `입금이 정상 확인되어 포인트가 충전되었습니다.\n\n` +
        `**입금자명:** ${payment.senderName}\n` +
        `**충전 금액:** ${Number(payment.points ?? payment.amount).toLocaleString('ko-KR')}P`
      )
    );

  return patchOriginalReply(payment.interactionToken, {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
  });
}

export async function markDepositReplyExpired(payment) {
  const container = new ContainerBuilder()
    .setAccentColor(0xE74C3C)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ⌛ 입금 신청 만료\n\n` +
        `5분 이내에 입금이 확인되지 않아 신청이 만료되었습니다.\n\n` +
        `**입금자명:** ${payment.senderName}\n` +
        `**신청 금액:** ${Number(payment.amount).toLocaleString('ko-KR')}원\n\n` +
        `이미 입금하셨다면 관리자에게 문의해주세요.`
      )
    );

  return patchOriginalReply(payment.interactionToken, {
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2,
  });
}
