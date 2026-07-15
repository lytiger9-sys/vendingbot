import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ÀÜ¾×º¸±â")
    .setDescription("ò¦ïÒªµªìª¿«æ?«¶?ªÎ?ÍÔªòü¬ìãª·ªŞª¹")
    .addUserOption(option =>
      option.setName("À¯Àú")
        .setDescription("ÀÜ¾×À» È®ÀÎÇÒ À¯Àú")
        .setRequired(false)
    ),
  async execute(interaction, client, prisma) {
    const targetUser = interaction.options.getUser("À¯Àú") || interaction.user;
    
    const user = await prisma.user.findUnique({ where: { id: targetUser.id } });
    
    const embed = new EmbedBuilder()
      .setTitle("ÀÜ¾× Á¶È¸")
      .setColor("#5865F2")
      .addFields(
        { name: "À¯Àú", value: targetUser.tag, inline: true },
        { name: "ÀÜ¾×", value: `${(user?.balance || 0).toLocaleString()}¿ø`, inline: true },
        { name: "´©Àû±¸¸Å", value: `${(user?.totalSpent || 0).toLocaleString()}¿ø`, inline: true }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
