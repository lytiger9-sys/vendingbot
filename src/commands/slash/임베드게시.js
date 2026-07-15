import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from \"discord.js\";

export default {
  data: new SlashCommandBuilder()
    .setName(\"임베드게시\")
    .setDescription(\"상점 임베드를 게시합니다\")
    .addChannelOption(option =>
      option.setName(\"채널\")
        .setDescription(\"임베드를 게시할 채널\")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),
  async execute(interaction, client, prisma) {
    await interaction.deferReply({ ephemeral: true });
    
    const settings = await prisma.embedSetting.findUnique({ where: { id: \"main_shop\" } }) || {
      title: \"상점에 오신 것을 환영합니다\",
      description: \"아래 버튼을 눌러 원하는 서비스를 이용하세요.\",
      color: \"#5865F2\"
    };
    
    const targetChannel = interaction.options.getChannel(\"채널\") || interaction.channel;
    
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(\"btn_deposit\").setLabel(\"입금\").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(\"btn_products\").setLabel(\"상품\").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(\"btn_my_info\").setLabel(\"내정보\").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(\"btn_review_info\").setLabel(\"후기\").setStyle(ButtonStyle.Secondary)
    );
    
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(\"홈페이지\")
        .setStyle(ButtonStyle.Link)
        .setURL(process.env.DASHBOARD_URL || \"http://localhost:3000\")
    );
    
    const embed = new EmbedBuilder()
      .setTitle(settings.title)
      .setDescription(settings.description)
      .setColor(settings.color)
      .setFooter(settings.footerText ? { text: settings.footerText } : null)
      .setTimestamp();
    
    await targetChannel.send({ embeds: [embed], components: [row1, row2] });
    await interaction.editReply({ content: `${targetChannel} 채널에 임베드가 게시되었습니다.` });
  }
};
