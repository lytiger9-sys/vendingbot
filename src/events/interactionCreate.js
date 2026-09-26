import { Events, MessageFlags } from 'discord.js';
import { prisma } from '../index.js';
import { handleButton, handleSelectMenu, handleModalSubmit } from './handlers/index.js';
import { ensureUserExists } from '../utils/ensureUser.js';
import { withTimeout } from '../utils/promiseTimeout.js';
import {
  deferInteraction,
  deferUpdateInteraction,
  handleInteractionError,
  getDiscordErrorCode,
  isExpiredInteractionError,
} from '../utils/interactionResponse.js';

const INTERACTION_HANDLER_TIMEOUT_MS = 12_000;

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    try {
      const customId = interaction.customId ?? interaction.commandName;
      console.log(`[interaction] received: ${customId || 'unknown'}`);

      // 모달은 최초 상호작용에서만 열 수 있으므로 defer하지 않고 바로 핸들러로 보냅니다.
      // 나머지 컴포넌트는 DB 작업 전에 즉시 승인해 Discord의 3초 제한을 지킵니다.
      const opensModal =
        (interaction.isButton() && interaction.customId === 'btn_deposit') ||
        (interaction.isStringSelectMenu() && (
          interaction.customId === 'select_product' ||
          interaction.customId === 'select_review_target'
        ));

      // 슬래시 명령어는 각 command.execute가 reply/defer를 직접 관리합니다.
      // 여기서 다시 defer하면 임베드게시·웹패널처럼 자체 defer하는 명령어와 충돌합니다.
      if (interaction.isButton() && !opensModal) {
        await deferInteraction(interaction, { ephemeral: true });
        console.log(`[interaction] acknowledged: ${customId}`);
      } else if (interaction.isStringSelectMenu() && !opensModal) {
        await deferUpdateInteraction(interaction);
        console.log(`[interaction] acknowledged: ${customId}`);
      } else if (interaction.isModalSubmit()) {
        await deferInteraction(interaction, { ephemeral: true });
        console.log(`[interaction] acknowledged: ${customId}`);
      }

      // 상호작용은 이미 defer/update로 승인했으므로, 이후 핸들러보다 먼저
      // 유저 레코드 생성을 끝내 신규 유저의 충전·구매 조회 race condition을 막습니다.
      if (!opensModal) {
        await ensureUserExists(prisma, interaction.user);
      }

      // 슬래시 명령어
      if (interaction.isChatInputCommand()) {
        const command = client.slashCommands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction, client, prisma);
        return;
      }

      // 버튼 인터랙션
      if (interaction.isButton()) {
        if (opensModal) {
          await handleButton(interaction, client, prisma);
        } else {
          await withTimeout(
            handleButton(interaction, client, prisma),
            INTERACTION_HANDLER_TIMEOUT_MS,
            `button handler (${customId})`,
          );
        }
        return;
      }

      // 셀렉트 메뉴 인터랙션
      if (interaction.isStringSelectMenu()) {
        if (opensModal) {
          await handleSelectMenu(interaction, client, prisma);
        } else {
          await withTimeout(
            handleSelectMenu(interaction, client, prisma),
            INTERACTION_HANDLER_TIMEOUT_MS,
            `select-menu handler (${customId})`,
          );
        }
        return;
      }

      // 모달 제출 인터랙션
      if (interaction.isModalSubmit()) {
        await withTimeout(
          handleModalSubmit(interaction, client, prisma),
          INTERACTION_HANDLER_TIMEOUT_MS,
          `modal handler (${customId})`,
        );
        return;
      }
    } catch (error) {
      const errorCode = getDiscordErrorCode(error);
      console.error('Interaction Execution Error:', {
        customId: interaction.customId ?? interaction.commandName,
        code: error?.code,
        message: error?.message,
      });

      // 10062는 Discord가 이미 만료·사용 처리한 토큰입니다.
      // 이 토큰으로 reply/followUp를 재시도하면 2차 오류만 반복되므로 즉시 종료합니다.
      if (isExpiredInteractionError(error) || errorCode === 40060) {
        console.warn(`Interaction expired or already acknowledged (code ${errorCode}); no retry attempted.`);
        return;
      }

      // 이미 응답(replied)되거나 대기(deferred) 상태인지 확인하여 중복 응답을 방지합니다.
      try {
        await handleInteractionError(interaction, error, { flags: MessageFlags.Ephemeral });
      } catch (replyError) {
        // 응답 과정 자체에서 발생하는 2차 에러는 무시하여 무한 루프 차단
        console.error('Failed to send error message to user:', replyError);
      }
    }
  }
};
