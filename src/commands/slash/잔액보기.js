import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { replyInteraction } from '../../utils/interactionResponse.js';

export default {
  data: new SlashCommandBuilder()
    .setName("잔액보기")
    .setDescription("특정 유저의 잔액을 확인합니다")
    .addUserOption(option =>
      option.setName("유저")
        .setDescription("잔액을 확인할 유저")
        .setRequired(false)
    ),
  async execute(interaction, client, prisma) {
    const targetUser = interaction.options.getUser("유저") || interaction.user;
    
    const user = await prisma.user.findUnique({ where: { id: targetUser.id } });
    
    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 잔액 조회'),
      )
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**유저:** ${targetUser.tag}\n` +
          `**잔액:** ${(user?.balance || 0).toLocaleString()}원\n` +
          `**누적 구매:** ${(user?.totalSpent || 0).toLocaleString()}원`,
        ),
      );
    
    await replyInteraction(interaction, {
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true,
    });
  }
};
