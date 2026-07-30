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
