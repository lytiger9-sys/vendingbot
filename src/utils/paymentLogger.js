import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';

async function getSetting(prisma, key) {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  return setting?.value?.trim() || '';
}

function buildContainer({ title, description, color, fields, footer }) {
  const container = new ContainerBuilder()
    .setAccentColor(color ?? 0x5865F2)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}`),
    );

  if (description) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(description),
      );
  }

  if (Array.isArray(fields) && fields.length > 0) {
    const fieldText = fields
      .map(({ name, value }) => `**${name}:** ${value}`)
      .join('\n');

    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(fieldText),
      );
  }

  if (footer) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`*${footer}*`),
      );
  }

  return container;
}

function v2Payload(container) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

export async function sendPaymentLog(client, prisma, channelSettingKey, options) {
  try {
    if (!client?.isReady?.()) {
      return false;
    }

    const channelId = await getSetting(prisma, channelSettingKey);
    if (!channelId) {
      return false;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
      return false;
    }

    await channel.send(v2Payload(buildContainer(options)));
    return true;
  } catch (error) {
    console.error('Payment log error:', error);
    return false;
  }
}

const CHARGE_STATUS_INFO = {
  PENDING:   { text: '⏳ 대기중',        color: 0xF1C40F },
  COMPLETED: { text: '✅ 충전 완료',      color: 0x2ECC71 },
  EXPIRED:   { text: '⌛ 자동충전 만료',  color: 0xE74C3C },
  REJECTED:  { text: '🚫 거절됨',        color: 0xE74C3C },
  FAILED:    { text: '❌ 자동충전 실패',  color: 0xE74C3C },
};

function buildChargeContainer(payment) {
  const info = CHARGE_STATUS_INFO[payment.status] || {
    text: payment.status,
    color: 0x5865F2,
  };
  const typeLabel = payment.type === 'MANUAL' ? '수동충전' : '자동충전';

  return buildContainer({
    title: `💰 충전 요청 - ${typeLabel}`,
    color: info.color,
    fields: [
      { name: '유저', value: `<@${payment.userId}>` },
      { name: '입금자명', value: payment.senderName || '-' },
      { name: '금액', value: `${Number(payment.amount || 0).toLocaleString()}원` },
      { name: '상태', value: info.text },
    ],
    footer: `Payment ID: ${payment.id}`,
  });
}

/**
 * 충전 요청(Payment) 1건당 로그 메시지 1개를 유지한다.
 * 처음 호출되면 새 Components V2 메시지를 보내고, 이후 상태가 바뀌면
 * 같은 메시지를 Components V2 payload로 수정한다.
 */
export async function upsertChargeLog(client, prisma, payment) {
  try {
    if (!client?.isReady?.()) return;

    const channelId = await getSetting(prisma, 'CHARGE_LOG_CHANNEL');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) return;

    const payload = v2Payload(buildChargeContainer(payment));

    if (payment.logChannelId && payment.logMessageId) {
      try {
        const existingChannel = payment.logChannelId === channel.id
          ? channel
          : await client.channels.fetch(payment.logChannelId).catch(() => null);

        if (existingChannel) {
          const existingMessage = await existingChannel.messages.fetch(payment.logMessageId).catch(() => null);
          if (existingMessage) {
            await existingMessage.edit(payload);
            return;
          }
        }
      } catch (editError) {
        console.error('충전 로그 메시지 수정 실패, 새 메시지로 대체합니다:', editError);
      }
    }

    const sentMessage = await channel.send(payload);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { logChannelId: channel.id, logMessageId: sentMessage.id },
    });
  } catch (error) {
    console.error('충전 로그 처리 오류:', error);
  }
}

export { buildContainer };
