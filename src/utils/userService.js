export async function ensureUserRecord(prisma, discordUser) {
  if (!discordUser?.id) {
    throw new Error('discordUser.id is required');
  }

  return prisma.user.upsert({
    where: { id: discordUser.id },
    update: {
      username: discordUser.username ?? '',
      avatar: discordUser.avatar ?? null
    },
    create: {
      id: discordUser.id,
      username: discordUser.username ?? '',
      avatar: discordUser.avatar ?? null
    }
  });
}
