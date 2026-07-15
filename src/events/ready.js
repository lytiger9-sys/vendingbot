import { Events } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, prisma) {
    console.log(`✅ Bot is ready as ${client.user.tag}`);
    console.log(`📢 Serving ${client.guilds.cache.size} servers`);
  }
};
