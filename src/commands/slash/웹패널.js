import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("웹패널")
    .setDescription("웹 대시보드 링크를 제공합니다"),
  async execute(interaction, client, prisma) {
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
    
    const embed = new EmbedBuilder()
      .setTitle("웹 대시보드")
      .setDescription("아래 버튼을 클릭하여 웹패널로 이동하세요.")
      .setColor("#5865F2");
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("웹패널 열기")
        .setStyle(ButtonStyle.Link)
        .setURL(dashboardUrl)
        .setEmoji("??")
    );
    
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
};
