import { Events } from 'discord.js';
import { prisma } from '../index.js';
import { handleButton, handleSelectMenu, handleModalSubmit } from './handlers/index.js';
import { ensureUserExists } from '../utils/ensureUser.js';

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    // 모든 상호작용 진입 시, 이 유저의 User 레코드가 DB에 존재하는지 먼저 보장한다.
    // (웹 대시보드 로그인 없이 디스코드에서만 활동하는 유저 대비용 최종 안전망)
    await ensureUserExists(prisma, interaction.user);

    // 슬래시 명령어
    if (interaction.isChatInputCommand()) {
      const command = client.slashCommands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client, prisma);
      } catch (error) {
        console.error('Command error:', error);
        await interaction.reply({ content: '명령어 처리 중 오류가 발생했습니다.', ephemeral: true });
      }
      return;
    }

    // 버튼 인터랙션
    if (interaction.isButton()) {
      await handleButton(interaction, client, prisma);
      return;
    }

    // 셀렉트 메뉴 인터랙션
    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction, client, prisma);
      return;
    }

    // 모달 제출 인터랙션
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction, client, prisma);
      return;
    }
  }
};