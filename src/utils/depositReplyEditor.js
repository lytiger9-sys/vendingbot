import { ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';

function getApplicationId() {
  return process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID || '';
}

// discord.js의 REST 매니저와 동일한 rest 인스턴스를 재사용합니다.
// 봇 토큰으로 인증하지만, 웹훅 메시지 수정(@original) 엔드포인트는 봇 토큰 없이도
// interaction token만으로 동작하므로 별도의 인증 없는 REST 인스턴스를 씁니다.
// (봇 토큰을 세팅해도 무방하지만, webhook 엔드포인트는 토큰을 요구하지 않습니다.)
const rest = new REST({ version: '10' });

/**
 * interaction.token으로 원본 ephemeral 응답(@original)을 수정한다.
 * interaction.token은 최초 응답 후 15분간만 유효하다.
 * (자동충전 5분 윈도우 안에서는 항상 유효함)
 *
 * @discordjs/rest를 사용해 Discord의 레이트리밋(429/Retry-After, 글로벌 리밋 등)을
 * 자동으로 큐잉/백오프 처리한다. 기존에는 raw fetch를 써서 이 로직이 전혀 없었고,
 * 그게 대량 만료 처리 시 Discord 글로벌 레이트리밋을 유발해 OAuth 로그인까지
 * 막히는 원인이었다.
 */
async function patchOriginalReply(interactionToken, payload) {
  const applicationId = getApplicationId();
  if (!applicationId || !interactionToken) {
    return false;
  }

  try {
    await rest.patch(
      Routes.webhookMessage(applicationId, interactionToken, '@original'),
      { body: payload }
    );
    return true;
  } catch (error) {
    // 15분이 지났거나, 유저가 메시지를 직접 지운 경우 등은 조용히 무시
    // (DM이 최종 안내 수단이므로 여기서 실패해도 치명적이지 않음)
    const status = error?.status ?? error?.rawError?.code;
    console.warn(`[deposit-reply] failed to edit original reply (${status ?? 'unknown'}):`, error?.rawError ?? error?.message ?? error);
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
