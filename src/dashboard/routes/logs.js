import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get payments (charges)
router.get('/payments', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { senderName: { contains: search } },
        { userId: { contains: search } }
      ];
    }
    
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.payment.count({ where })
    ]);
    
    res.json({ payments, total });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// Get receipts (purchases)
router.get('/receipts', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;
    
    const where = {};
    if (search) {
      where.OR = [
        { userId: { contains: search } },
        { productId: search ? { equals: parseInt(search) } : undefined }
      ];
    }
    
    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        include: { user: true, product: true },
        orderBy: { purchasedAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset)
      }),
      prisma.receipt.count({ where })
    ]);
    
    res.json({ receipts, total });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// Approve/Reject payment
router.put('/payments/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const payment = await prisma.payment.update({
      where: { id: req.params.id },
      data: { status }
    });
    
    if (status === 'COMPLETED') {
      await prisma.user.update({
        where: { id: payment.userId },
        data: { balance: { increment: payment.points } }
      });
    }
    
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

export default router;