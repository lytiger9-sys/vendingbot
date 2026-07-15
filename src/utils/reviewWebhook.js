import { EmbedBuilder } from 'discord.js';

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
    
    const embed = new EmbedBuilder()
      .setTitle('새로운 후기')
      .setColor('#FFD700')
      .addFields(
        { name: '유저', value: user.id, inline: true },
        { name: '제품', value: receipt.product?.name || '알 수 없음', inline: true },
        { name: '평점', value: stars, inline: true },
        { name: '후기', value: content || '후기 내용 없음' }
      )
      .setTimestamp();
    
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Review webhook error:', error);
  }
}

async function getSetting(key) {
  const { prisma } = await import('../index.js');
  const setting = await prisma.systemSetting.findUnique({ where: { key } });
  return setting?.value;
};
