import { Events, MessageFlags } from 'discord.js';
import { prisma } from '../index.js';
import { handleButton, handleSelectMenu, handleModalSubmit } from './handlers/index.js';
import { ensureUserExists } from '../utils/ensureUser.js';

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      // 모든 상호작용 진입 시 DB 유저 존재 보장
      await ensureUserExists(prisma, interaction.user);

      // 슬래시 명령어
      if (interaction.isChatInputCommand()) {
        const command = client.slashCommands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client, prisma);
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
    } catch (error) {
      console.error('Interaction Execution Error:', error);

      // 이미 응답(replied)되거나 대기(deferred) 상태인지 확인하여 무한 에러 방지
      const errorMessage = { content: '⚠️ 처리 중 오류가 발생했습니다.', flags: MessageFlags.Ephemeral };

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        // 응답 과정 자체에서 발생하는 2차 에러는 무시하여 무한 루프 차단
        console.error('Failed to send error message to user:', replyError);
      }
    }
  }
};