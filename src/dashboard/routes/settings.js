import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

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
    imageUrl: null,
    thumbnailUrl: null
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
    const { title, description, color, footerText, imageUrl, thumbnailUrl } = req.body;
    const embed = await prisma.embedSetting.upsert({
      where: { id: 'main_shop' },
      update: { title, description, color, footerText, imageUrl, thumbnailUrl },
      create: {
        id: 'main_shop',
        title,
        description,
        color,
        footerText,
        imageUrl,
        thumbnailUrl
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
    const { channelId, title, description, color, footerText, thumbnailUrl, imageUrl } = req.body;
    
    const { client } = req.app.locals;
    if (!client || !client.isReady()) {
      return res.status(500).json({ success: false, error: 'Discord 클라이언트가 준비되지 않았습니다' });
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ success: false, error: '유효하지 않은 채널 ID입니다' });
    }

    const embed = {
      title: title || undefined,
      description: description || undefined,
      color: color ? parseInt(color.replace('#', ''), 16) : 0x5865F2,
      footer: footerText ? { text: footerText } : undefined,
      thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
      image: imageUrl ? { url: imageUrl } : undefined
    };

    await channel.send({ embeds: [embed] });
    res.json({ success: true });
  } catch (error) {
    console.error('Embed test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;