import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName("수동충전")
    .setDescription("특정 유저에게 수동으로 잔액을 충전합니다")
    .addUserOption(option =>
      option.setName("유저")
        .setDescription("충전할 유저")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("금액")
        .setDescription("충전할 금액 (마이너스 가능)")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction, client, prisma) {
    const targetUser = interaction.options.getUser("유저");
    const amount = parseInt(interaction.options.getString("금액").replace(/,/g, ''));
    
    if (isNaN(amount)) {
      return interaction.reply({ content: "⚠️ 유효한 금액을 입력해주세요.", ephemeral: true });
    }
    
    const user = await prisma.user.findUnique({ where: { id: targetUser.id } });
    
    if (!user) {
      return interaction.reply({ content: "⚠️ 데이터베이스에 해당 유저 정보가 존재하지 않습니다.", ephemeral: true });
    }
    
    let newBalance = user.balance + amount;
    
    if (newBalance < 0) {
      return interaction.reply({ 
        content: `❌ 잔액은 0원 미만으로 설정할 수 없습니다. (현재 잔액: ${user.balance.toLocaleString()}원)`,
        ephemeral: true 
      });
    }
    
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { balance: newBalance }
    });
    
    const embed = new EmbedBuilder()
      .setTitle("🏦 수동 충전 완료")
      .setColor("#00FF00")
      .addFields(
        { name: "대상", value: `<@${targetUser.id}>`, inline: true },
        { name: "변동액", value: `\`${amount >= 0 ? '+' : ''}${amount.toLocaleString()}원\``, inline: true },
        { name: "최종 잔액", value: `\`${newBalance.toLocaleString()}원\``, inline: true }
      )
      .setTimestamp();
      
    await interaction.reply({ embeds: [embed] });
  }
};
