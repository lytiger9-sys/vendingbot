import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// Main dashboard route
router.get('/', (req, res) => {
  if (!req.user) {
    return res.redirect('/auth/discord');
  }
  
  const isAdminUser = req.user.id === process.env.ADMIN_USER_ID;
  
  // 관리자면 admin 대시보드로
  if (isAdminUser) {
    return res.redirect('/admin');
  }
  
  res.render('index', {
    user: req.user,
    isAdmin: false
  });
});

// Admin dashboard
router.get('/admin', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/dashboard', {
    user: req.user,
    isAdmin: true,
    page: 'home'
  });
});

// Admin - Products page
router.get('/admin/products', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/products', {
    user: req.user,
    isAdmin: true,
    page: 'products'
  });
});

// Admin - Logs page
router.get('/admin/logs', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/logs', {
    user: req.user,
    isAdmin: true,
    page: 'logs'
  });
});

// Admin - Settings page
router.get('/admin/settings', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/settings', {
    user: req.user,
    isAdmin: true,
    page: 'settings'
  });
});

// Admin - Roles page
router.get('/admin/roles', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/roles', {
    user: req.user,
    isAdmin: true,
    page: 'roles'
  });
});

// Admin - Embed page
router.get('/admin/embed', isAuthenticated, isAdmin, async (req, res) => {
  res.render('admin/embed', {
    user: req.user,
    isAdmin: true,
    page: 'embed'
  });
});

// Admin - Monthly Stats
router.get('/admin/stats', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const [monthlyReceipts, monthlyPayments, topProducts] = await Promise.all([
      prisma.receipt.aggregate({
        where: { purchasedAt: { gte: startOfMonth } },
        _sum: { paidAmount: true },
        _count: true
      }),
      prisma.payment.aggregate({
        where: { 
          status: 'COMPLETED',
          createdAt: { gte: startOfMonth }
        },
        _sum: { amount: true },
        _count: true
      }),
      prisma.receipt.groupBy({
        by: ['productId'],
        _sum: { paidAmount: true },
        _count: true,
        orderBy: { _count: { productId: 'desc' } },
        take: 5
      })
    ]);
    
    const productIds = topProducts.map(p => p.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } }
    });
    
    res.json({
      monthlySales: monthlyReceipts._sum.paidAmount || 0,
      monthlyRecharge: monthlyPayments._sum.amount || 0,
      salesCount: monthlyReceipts._count || 0,
      rechargeCount: monthlyPayments._count || 0,
      topProducts: topProducts.map(p => ({
        ...p,
        product: products.find(pr => pr.id === p.productId)
      }))
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Admin - Roles API (JSON)
router.get('/api/admin/roles', isAuthenticated, isAdmin, async (req, res) => {
  const roles = await prisma.roleReward.findMany({
    orderBy: { spentLimit: 'asc' }
  });
  res.json(roles);
});

router.post('/api/admin/roles', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { spentLimit, roleId } = req.body;
    const role = await prisma.roleReward.create({
      data: { spentLimit: parseInt(spentLimit), roleId }
    });
    res.json(role);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create role reward' });
  }
});

router.delete('/api/admin/roles/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await prisma.roleReward.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete role reward' });
  }
});

export default router;