import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import { 
  ContainerBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  MessageFlags,
  TextDisplayBuilder,   // 추가
  SeparatorBuilder,     // 추가
  MediaGalleryBuilder,   // 추가
  MediaGalleryItemBuilder // 추가
} from 'discord.js';

const router = express.Router();

// Get all settings
router.get('/', isAuthenticated, isAdmin, async (req, res) => {
  const settings = await prisma.systemSetting.findMany();
  const embedSettings = await prisma.embedSetting.findUnique({
    where: { id: 'main_shop' }
  }) || {
    id: 'main_shop',
    title: '자판기에 오신 것을 환영합니다',
    description: '아래 버튼을 눌러 원하는 서비스를 이용하세요.',
    color: '#5865F2',
    footerText: ''
  };
  res.json({ settings, embedSettings });
});

// Get embed settings only
router.get('/embed', isAuthenticated, isAdmin, async (req, res) => {
  const embedSettings = await prisma.embedSetting.findUnique({
    where: { id: 'main_shop' }
  }) || {
    id: 'main_shop',
    title: '',
    description: '',
    color: '#5865F2',
    footerText: '',
    imageUrl: null
  };
  res.json({ embedSettings });
});

// Update system settings
router.post('/', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
    res.json(setting);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

// Update embed settings
router.post('/embed', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { title, description, color, footerText, imageUrl } = req.body;
    const embed = await prisma.embedSetting.upsert({
      where: { id: 'main_shop' },
      update: { title, description, color, footerText, imageUrl },
      create: {
        id: 'main_shop',
        title,
        description,
        color,
        footerText,
        imageUrl
      }
    });
    res.json(embed);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save embed settings' });
  }
});

// Test embed message
router.post('/embed/test', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { channelId, title, description, color, footerText, imageUrl } = req.body;
    
    const { client } = req.app.locals;
    if (!client || !client.isReady()) {
      return res.status(500).json({ success: false, error: 'Discord 클라이언트가 준비되지 않았습니다' });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ success: false, error: '유효하지 않은 채널 ID입니다' });
    }

    const rawColor = color ? parseInt(color.replace('#', ''), 16) : 0x5865F2;

    // [1. 최상위 Container 생성 및 색상 설정]
    const container = new ContainerBuilder()
      .setAccentColor(rawColor);

    // [2. 메인 타이틀 및 상점 설명 텍스트 배치]
    const finalTitle = title || '자판기에 오신 것을 환영합니다';
    const finalDesc = description || '아래 버튼을 눌러 원하는 서비스를 이용하세요.';
    
    const mainText = new TextDisplayBuilder()
      .setContent(`## ${finalTitle}\n\n${finalDesc}`);
    container.addTextDisplayComponents(mainText);

    // 제목 밑 구분선 추가
    container.addSeparatorComponents(new SeparatorBuilder());

    // [3. 사진 (미디어 갤러리) 배치 - 요청하셨던 버튼 위 구성 순서 동일 적용]
    if (imageUrl && imageUrl.trim() !== '') {
      const mediaGallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl.trim())
      );
      container.addMediaGalleryComponents(mediaGallery);
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    // [4. 버튼 인터랙션 구역 생성]
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("btn_deposit").setLabel("입금").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("btn_products").setLabel("상품").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("btn_my_info").setLabel("내정보").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("btn_review_info").setLabel("후기").setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(buttonRow);

    // [5. 푸터 텍스트 배치 (있는 경우에만 추가)]
    if (footerText && footerText.trim() !== '') {
      container.addSeparatorComponents(new SeparatorBuilder());
      const footerComponent = new TextDisplayBuilder()
        .setContent(`*${footerText}*`);
      container.addTextDisplayComponents(footerComponent);
    }

    // ⚠️ 수정 핵심: embeds 배열을 지우고 오직 컴포넌트 V2 단독 전송 구조로 변경
    await channel.send({ 
      components: [container],
      flags: [MessageFlags.IsComponentsV2]
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Embed test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;