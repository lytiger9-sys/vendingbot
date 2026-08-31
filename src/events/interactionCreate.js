import { Events, MessageFlags } from 'discord.js';
import { prisma } from '../index.js';
import { handleButton, handleSelectMenu, handleModalSubmit } from './handlers/index.js';
import { ensureUserExists } from '../utils/ensureUser.js';

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      // Discord 인터랙션은 3초 안에 최초 응답이 필요하므로 DB 조회 전에 즉시 승인합니다.
      // 무거운 버튼/셀렉트/모달 작업은 이후 editReply/update로 마무리합니다.
      const heavyButton = interaction.isButton() && (
        interaction.customId === 'btn_products' ||
        interaction.customId === 'btn_my_info' ||
        interaction.customId === 'btn_review_discord' ||
        interaction.customId === 'btn_review_info' ||
        interaction.customId.startsWith('purchase_confirm_')
      );
      // 슬래시 명령어는 각 command.execute가 reply/defer를 직접 관리합니다.
      // 여기서 다시 defer하면 임베드게시·웹패널처럼 자체 defer하는 명령어와 충돌합니다.
      if (heavyButton && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
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
      const errorCode = error?.code ?? error?.rawError?.code;
      console.error('Interaction Execution Error:', error);

      // 10062는 Discord가 이미 만료·사용 처리한 토큰입니다.
      // 이 토큰으로 reply/followUp를 재시도하면 2차 오류만 반복되므로 즉시 종료합니다.
      if (errorCode === 10062 || errorCode === 10015) {
        console.warn(`Interaction expired or already acknowledged (code ${errorCode}); no retry attempted.`);
        return;
      }

      // 이미 응답(replied)되거나 대기(deferred) 상태인지 확인하여 중복 응답을 방지합니다.
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