import { Events } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, prisma) {
    console.log(? Bot is ready as );
    console.log(?? Serving  servers);
  }
};
