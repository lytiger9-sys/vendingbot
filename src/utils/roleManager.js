import { prisma } from '../index.js';

export async function checkAndGiveRole(userId, prisma, client) {
  try {
    // SERVER_ID 검증 - 지정된 서버가 아니면 무시
    const serverId = process.env.SERVER_ID;
    if (!serverId) {
      console.log('SERVER_ID not configured');
      return;
    }
    
    const guild = client.guilds.cache.get(serverId);
    if (!guild) {
      console.log('Guild not found for SERVER_ID:', serverId);
      return;
    }
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    
    const roleRewards = await prisma.roleReward.findMany({
      orderBy: { spentLimit: 'desc' }
    });
    
    const discordUser = await guild.members.fetch(userId).catch(() => null);
    if (!discordUser) return;
    
    const rolesToGive = roleRewards.filter(r => user.totalSpent >= r.spentLimit).map(r => r.roleId);
    const allRewardRoleIds = roleRewards.map(r => r.roleId);
    
    for (const roleId of allRewardRoleIds) {
      if (!rolesToGive.includes(roleId)) {
        const role = guild.roles.cache.get(roleId);
        if (role && discordUser.roles.cache.has(roleId)) {
          await discordUser.roles.remove(role).catch(() => {});
        }
      }
    }
    
    for (const roleId of rolesToGive) {
      const role = guild.roles.cache.get(roleId);
      if (role && !discordUser.roles.cache.has(roleId)) {
        await discordUser.roles.add(role).catch(() => {});
      }
    }
  } catch (error) {
    console.error('Role check error:', error);
  }
}