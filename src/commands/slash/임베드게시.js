import { 
  SlashCommandBuilder, 
  ChannelType, 
  MessageFlags, 
  ButtonBuilder, 
  ButtonStyle,
  ContainerBuilder, 
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  MediaGalleryBuilder,     
  MediaGalleryItemBuilder 
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("임베드게시")
    .setDescription("상점 임베드를 게시합니다")
    .addChannelOption(option =>
      option.setName("채널")
        .setDescription("임베드를 게시할 채널")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),
  async execute(interaction, client, prisma) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const dbSettings = await prisma.embedSetting.findUnique({ where: { id: "main_shop" } });
    
    const settings = {
      title: dbSettings?.title || '상점에 오신 것을 환영합니다',
      description: dbSettings?.description || '아래 버튼을 눌러 원하는 서비스를 이용하세요.',
      color: dbSettings?.color || '#5865F2',
      footerText: dbSettings?.footerText || 'Powered by 내 자판기',
      imageUrl: dbSettings?.imageUrl || null
    };
    
    const targetChannel = interaction.options.getChannel("채널") || interaction.channel;
    
    const rawColor = parseInt(settings.color.replace("#", ""), 16);

    // [1. 최상위 Container 생성]
    const container = new ContainerBuilder()
      .setAccentColor(rawColor);

    // [2. 메인 타이틀 및 설명 텍스트 배치]
    const mainText = new TextDisplayBuilder()
      .setContent(`## ${settings.title}\n\n${settings.description}`);
    container.addTextDisplayComponents(mainText);

    // ─── 제목 밑 구분선 ───
    container.addSeparatorComponents(new SeparatorBuilder());

    // ✨ [3. 사진(미디어 갤러리)을 버튼보다 먼저 배치]
    if (settings.imageUrl) {
      const mediaGallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(settings.imageUrl)
      );
      container.addMediaGalleryComponents(mediaGallery);
      
      // 사진 아래에도 구분선을 추가해 버튼 구역과 깔끔하게 분리합니다.
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    // ✨ [4. 버튼 인터랙션 구역을 사진 아래에 배치]
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("btn_deposit").setLabel("입금").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("btn_products").setLabel("상품").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("btn_my_info").setLabel("내정보").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("btn_review_info").setLabel("후기").setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(buttonRow);

    // ─── 푸터 위 구분선 ───
    container.addSeparatorComponents(new SeparatorBuilder());

    // [5. 하단 푸터 텍스트 추가]
    const footerText = new TextDisplayBuilder()
      .setContent(`*${settings.footerText}*`);
    container.addTextDisplayComponents(footerText);
    
    try {
      await targetChannel.send({ 
        components: [container],
        flags: [MessageFlags.IsComponentsV2]
      });

      await interaction.editReply({ content: `${targetChannel} 채널에 레이아웃 순서가 조정된 신형 임베드가 게시되었습니다.` });
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: "컴포넌트 V2 전송 중 디스코드 API 오류가 발생했습니다." });
    }
  }
};