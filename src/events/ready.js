import { Events, REST, Routes, EmbedBuilder } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client, prisma) {
    console.log(`✅ Bot is ready as ${client.user.tag}`);
    console.log(`📢 Serving ${client.guilds.cache.size} servers`);

    // 슬래시 명령어 Discord API 등록
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
      
      const commandData = client.slashCommands.map(cmd => cmd.data.toJSON());
      
      if (commandData.length === 0) {
        console.log('⚠️ 등록할 슬래시 명령어가 없습니다.');
        return;
      }

      // 글로벌 명령어로 등록
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commandData }
      );

      console.log(`✅ ${commandData.length}개의 슬래시 명령어를 Discord에 등록했습니다.`);

      // 등록 완료 알림을 개발자에게 DM
      try {
        const devUser = await client.users.fetch(process.env.DEV_USER_ID || '000000000000000000');
        if (devUser.id !== '000000000000000000') {
          const embed = new EmbedBuilder()
            .setTitle('✅ 슬래시 명령어 등록 완료')
            .setColor('#00FF00')
            .setDescription(`**${commandData.length}개**의 명령어가 등록되었습니다.`)
            .addFields(
              ...commandData.map(cmd => ({
                name: `/${cmd.name}`,
                value: cmd.description || '설명 없음',
                inline: true
              }))
            )
            .setTimestamp();

          await devUser.send({ embeds: [embed] });
        }
      } catch (devError) {
        // 개발자 DM 실패는 무시
      }

    } catch (error) {
      console.error('❌ 슬래시 명령어 등록 실패:', error);
    }
  }
};
