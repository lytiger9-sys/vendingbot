import { PermissionFlagsBits } from 'discord.js';

export function isAuthenticated(req, res, next) {
  if (req.user) {
    return next();
  }
  res.redirect('/auth/discord');
}

export async function isServerAdmin(req) {
  const serverId = process.env.SERVER_ID;
  const client = req.app?.locals?.client;

  if (!req.user || !serverId || !client?.isReady?.()) {
    return false;
  }

  try {
    const guild = await client.guilds.fetch(serverId);
    const member = await guild.members.fetch(req.user.id).catch(() => null);

    if (!member) {
      return false;
    }

    return member.permissions.has(PermissionFlagsBits.Administrator);
  } catch (error) {
    console.error('관리자 권한 확인 오류:', error);
    return false;
  }
}

export async function isAdmin(req, res, next) {
  if (await isServerAdmin(req)) {
    return next();
  }

  res.redirect('/');
}
