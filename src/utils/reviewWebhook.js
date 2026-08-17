import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';

export async function sendReviewWebhook(user, receipt, rating, content, client) {
  try {
    const { prisma } = await import('../index.js');
    const reviewChannelId = await getSetting('REVIEW_CHANNEL_ID');
    if (!reviewChannelId) {
      console.log('Review channel not configured');
      return;
    }

    const guild = client.guilds.cache.first();
    if (!guild) return;

    const channel = guild.channels.cache.get(reviewChannelId);
    if (!channel) return;

    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const container = new ContainerBuilder()
      .setAccentColor(0xFFD700)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 새 후기'),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**유저:** <@${user.id}> (${user.username || '알 수 없음'})\n` +
          `**제품:** ${receipt.product?.name || '알 수 없음'}\n` +
          `**별점:** ${stars} (${rating}점)\n\n` +
          `${content || '후기 내용 없음'}`,
        ),
      );

    await channel.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error('Review webhook error:', error);
  }
}

async function getSetting(key) {
  const { prisma } = await import('../index.js');
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  return setting?.value;
}
