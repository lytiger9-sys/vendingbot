import { Events, MessageFlags } from 'discord.js';
import { prisma } from '../index.js';
import { handleButton, handleSelectMenu, handleModalSubmit } from './handlers/index.js';
import { ensureUserExists } from '../utils/ensureUser.js';

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      // 응답 가능한 인터랙션은 DB 조회보다 먼저 즉시 ack (3초 제한 방어)
      // 버튼/셀렉트/모달은 각 핸들러 내부에서 이미 defer 하고 있다면 여기선 생략해도 됨.
      // 슬래시 명령어처럼 defer를 개별 커맨드에서 안 하는 경우를 위한 기본 방어선:
      if (interaction.isChatInputCommand() && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      // 모든 상호작용 진입 시 DB 유저 존재 보장 (defer 이후이므로 시간이 걸려도 안전)
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