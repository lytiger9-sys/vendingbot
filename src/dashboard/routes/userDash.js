import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated } from '../middleware/auth.js';

const router = express.Router();

// 봇 정보 미들웨어
router.use((req, res, next) => {
  const client = req.app.locals.client;
  if (client && client.user) {
    res.locals.botName = client.user.username;
    res.locals.botAvatar = client.user.displayAvatarURL({ format: 'png', size: 128 });
  } else {
    res.locals.botName = '자판기 봇';
    res.locals.botAvatar = '';
  }
  next();
});

// User dashboard
router.get('/', isAuthenticated, async (req, res) => {
  const isAdminUser = req.user.id === process.env.ADMIN_USER_ID;
  res.render('user/dashboard', {
    user: req.user,
    isAdmin: isAdminUser
  });
});

// User purchases page - dashboard 탭으로 리다이렉트
router.get('/purchases-page', isAuthenticated, async (req, res) => {
  res.redirect('/dashboard?tab=purchases');
});

// Get user purchase history
router.get('/purchases', isAuthenticated, async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      where: { userId: req.user.id },
      include: { product: true },
      orderBy: { purchasedAt: 'desc' }
    });
    res.json(receipts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch purchases' });
  }
});

// Get user monthly stats for chart
router.get('/stats', isAuthenticated, async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const receipts = await prisma.receipt.findMany({
      where: {
        userId: req.user.id,
        purchasedAt: { gte: sixMonthsAgo }
      },
      orderBy: { purchasedAt: 'asc' }
    });
    
    // Group by month
    const monthlyData = {};
    receipts.forEach(r => {
      const monthKey = r.purchasedAt.toISOString().substring(0, 7);
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { count: 0, amount: 0 };
      }
      monthlyData[monthKey].count++;
      monthlyData[monthKey].amount += r.paidAmount;
    });
    
    res.json({
      user: req.user,
      monthlyData,
      totalPurchases: receipts.length,
      totalSpent: receipts.reduce((sum, r) => sum + r.paidAmount, 0)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Submit review
router.post('/reviews', isAuthenticated, async (req, res) => {
  try {
    const { receiptId, rating, content } = req.body;
    
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, userId: req.user.id },
      include: { product: true }
    });
    
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    await prisma.receipt.update({
      where: { id: receiptId },
      data: { hasReview: true }
    });
    
    // Send review to Discord channel via webhook
    if (global.sendReviewWebhook) {
      await global.sendReviewWebhook(req.user, receipt, rating, content);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

export default router;