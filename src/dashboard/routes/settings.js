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

export default router;