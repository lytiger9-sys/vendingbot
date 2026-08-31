import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  PermissionFlagsBits,
} from 'discord.js';
import { replyInteraction } from '../../utils/interactionResponse.js';

import { upsertChargeLog } from '../../utils/paymentLogger.js';

export default {
  data: new SlashCommandBuilder()
    .setName("수동충전")
    .setDescription("특정 유저의 잔액을 수동으로 충전하거나 차감합니다.")
    .addUserOption(option =>
      option.setName("유저")
        .setDescription("대상 유저")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("금액")
        .setDescription("변동할 금액 (차감 시 마이너스 입력: 예 -1000)")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, client, prisma) {
    const targetUser = interaction.options.getUser("유저");
    const rawAmount = interaction.options.getString("금액").replace(/,/g, '');
    const amount = Number(rawAmount);

    // 1. 유효한 숫자 및 정수 체크
    if (isNaN(amount) || !Number.isInteger(amount) || amount === 0) {
      return replyInteraction(interaction, { 
        content: "⚠️ 유효한 정수 금액을 입력해주세요. (0은 입력할 수 없습니다)", 
        ephemeral: true 
      });
    }

    // 2. 유저 데이터베이스 조회 (없으면 생성 - 웹 대시보드 로그인 없이
    //    디스코드 명령어만 쓴 유저는 User 레코드가 아예 없을 수 있음)
    const user = await prisma.user.upsert({
      where: { id: targetUser.id },
      update: {},
      create: {
        id: targetUser.id,
        username: targetUser.username,
        avatar: targetUser.avatar,
        balance: 0,
        totalSpent: 0,
        blacklisted: false
      }
    });

    const newBalance = user.balance + amount;

        // 3. 차감 후 잔액이 음수가 되는지 체크
    if (newBalance < 0) {
      return replyInteraction(interaction, { 
        content: `❌ 잔액은 0원 미만으로 설정할 수 없습니다.\n(현재 잔액: \`${user.balance.toLocaleString()}원\`, 시도한 금액: \`${amount.toLocaleString()}원\`)`,
        ephemeral: true 
      });
    }

    // 4. 음수(차감) / 양수(충전) 구분 처리
    const isDeduction = amount < 0;

    // 5. DB 업데이트 및 충전 로그 기록
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { balance: newBalance }
    });

    // 6. 충전 로그 기록 (Payment 테이블에 MANUAL 충전으로 기록)
    if (!isDeduction) {
      const manualPayment = await prisma.payment.create({
        data: {
          userId: targetUser.id,
          amount: Math.abs(amount),
          points: Math.abs(amount),
          senderName: `수동충전 (${interaction.user.tag})`,
          status: 'COMPLETED',
          type: 'MANUAL'
        }
      });

      await upsertChargeLog(client, prisma, manualPayment);
    }

    const absAmount = Math.abs(amount).toLocaleString();

    const container = new ContainerBuilder()
      .setAccentColor(isDeduction ? 0xFF3333 : 0x33FF77)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ${isDeduction ? '💸 수동 차감 완료' : '🏦 수동 충전 완료'}`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          isDeduction
            ? `<@${targetUser.id}>님의 잔액에서 **${absAmount}원**을 차감했습니다.`
            : `<@${targetUser.id}>님의 잔액에 **${absAmount}원**을 충전했습니다.`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**대상:** <@${targetUser.id}>\n` +
          `**${isDeduction ? '차감액' : '충전액'}:** ${amount > 0 ? '+' : ''}${amount.toLocaleString()}원\n` +
          `**최종 잔액:** ${newBalance.toLocaleString()}원`,
        ),
      );

    await replyInteraction(interaction, {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
};