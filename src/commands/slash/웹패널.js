import { 
  SlashCommandBuilder, 
  MessageFlags, 
  ButtonStyle, 
  ButtonBuilder, 
  ActionRowBuilder,
  ContainerBuilder, 
  TextDisplayBuilder, 
  SeparatorBuilder 
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("웹패널")
    .setDescription("웹 대시보드 링크를 제공합니다"),
  async execute(interaction, client, prisma) {
    // 1. 에피메럴(비공개) 응답 대기 시작
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
    const rawColor = parseInt("5865F2", 16);

    // [Components V2 빌더 구조]
    // 1. 최상위 컨테이너 생성 (브랜딩 컬러 적용)
    const container = new ContainerBuilder()
      .setAccentColor(rawColor);

    // 2. 메인 타이틀 및 설명 텍스트
    const mainContent = new TextDisplayBuilder()
      .setContent("# 🔗 웹 대시보드\n\n아래 버튼을 클릭하여 웹패널로 이동하세요.");
    container.addTextDisplayComponents(mainContent);

    // 3. 제목과 버튼 사이 구분선 추가 (에스테틱 강화)
    container.addSeparatorComponents(new SeparatorBuilder());

    // 4. 링크 버튼 생성 (Style 5 = Link)
    const linkButton = new ButtonBuilder()
      .setLabel("웹패널 열기")
      .setStyle(ButtonStyle.Link)
      .setURL(dashboardUrl);

    // 5. 버튼을 ActionRow에 담아 컨테이너에 추가
    const buttonRow = new ActionRowBuilder().addComponents(linkButton);
    container.addActionRowComponents(buttonRow);

    try {
      // [전송] 
      // components 배열에 container를 담고, 신형 UI 플래그(IsComponentsV2)를 활성화합니다.
      await interaction.editReply({
        components: [container],
        flags: [MessageFlags.IsComponentsV2]
      });

      // (선택 사항) 만약 답변이 아닌 새 메시지로 보내고 싶다면 아래 코드를 사용하세요.
      /*
      await interaction.channel.send({
        components: [container],
        flags: [MessageFlags.IsComponentsV2]
      });
      */
    } catch (error) {
      console.error(error);
      await interaction.editReply({ content: "❌ Components V2 임베드 전송 중 오류가 발생했습니다." });
    }
  }
};