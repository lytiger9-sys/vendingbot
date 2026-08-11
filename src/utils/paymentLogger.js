import { EmbedBuilder } from 'discord.js';

async function getSetting(prisma, key) {
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  return setting?.value?.trim() || '';
}

function buildEmbed(options) {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setColor(options.color ?? 0x5865F2)
    .setTimestamp();

  if (options.description) {
    embed.setDescription(options.description);
  }

  if (Array.isArray(options.fields) && options.fields.length > 0) {
    embed.addFields(options.fields);
  }

  if (options.footer) {
    embed.setFooter({ text: options.footer });
  }

  return embed;
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

    await channel.send({ embeds: [buildEmbed(options)] });
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

function buildChargeEmbed(payment) {
  const info = CHARGE_STATUS_INFO[payment.status] || { text: payment.status, color: 0x5865F2 };
  const typeLabel = payment.type === 'MANUAL' ? '수동충전' : '자동충전';

  return new EmbedBuilder()
    .setTitle(`💰 충전 요청 - ${typeLabel}`)
    .setColor(info.color)
    .addFields(
      { name: '유저', value: `<@${payment.userId}>`, inline: true },
      { name: '입금자명', value: payment.senderName || '-', inline: true },
      { name: '금액', value: `${payment.amount.toLocaleString()}원`, inline: true },
      { name: '상태', value: info.text, inline: true }
    )
    .setFooter({ text: `Payment ID: ${payment.id}` })
    .setTimestamp();
}

/**
 * 충전 요청(Payment) 1건당 로그 메시지 1개를 유지한다.
 * - 처음 호출되면 CHARGE_LOG_CHANNEL에 새 메시지를 보내고 메시지 ID를 DB에 저장한다.
 * - 이후 상태가 바뀔 때 다시 호출하면, 저장된 메시지를 찾아 내용만 수정한다.
 *   (메시지가 삭제되었거나 찾을 수 없으면 새로 하나 보낸다.)
 */
export async function upsertChargeLog(client, prisma, payment) {
  try {
    if (!client?.isReady?.()) return;

    const channelId = await getSetting(prisma, 'CHARGE_LOG_CHANNEL');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) return;

    const embed = buildChargeEmbed(payment);

    if (payment.logChannelId && payment.logMessageId) {
      try {
        const existingChannel = payment.logChannelId === channel.id
          ? channel
          : await client.channels.fetch(payment.logChannelId).catch(() => null);

        if (existingChannel) {
          const existingMessage = await existingChannel.messages.fetch(payment.logMessageId).catch(() => null);
          if (existingMessage) {
            await existingMessage.edit({ embeds: [embed] });
            return;
          }
        }
      } catch (editError) {
        console.error('충전 로그 메시지 수정 실패, 새 메시지로 대체합니다:', editError);
      }
    }

    const sentMessage = await channel.send({ embeds: [embed] });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { logChannelId: channel.id, logMessageId: sentMessage.id }
    });
  } catch (error) {
    console.error('충전 로그 처리 오류:', error);
  }
}