import {
  ContainerBuilder,
  Events,
  MessageFlags,
  REST,
  Routes,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { prisma } from '../index.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`Bot is ready as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} servers`);

    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
      const commandData = client.slashCommands.map(cmd => cmd.data.toJSON());

      if (commandData.length === 0) {
        console.log('No slash commands to register.');
        return;
      }

      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commandData }
      );

      console.log(`Registered ${commandData.length} slash commands to Discord.`);

      try {
        const devUserId = process.env.DEV_USER_ID;
        if (devUserId) {
          const devUser = await client.users.fetch(devUserId).catch(() => null);
          if (devUser) {
            const commandList = commandData
              .map(cmd => `**/${cmd.name}:** ${cmd.description || 'No description'}`)
              .join('\n');
            const container = new ContainerBuilder()
              .setAccentColor(0x00FF00)
              .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('## Slash commands registered'),
              )
              .addSeparatorComponents(new SeparatorBuilder())
              .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                  `Registered ${commandData.length} slash commands.\n\n${commandList}`,
                ),
              );

            await devUser.send({
              components: [container],
              flags: MessageFlags.IsComponentsV2,
            });
          }
        }
      } catch (devError) {
        console.error('Failed to notify dev user:', devError);
      }
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  }
};
