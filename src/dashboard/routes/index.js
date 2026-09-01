import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated, isAdmin, isServerAdmin } from '../middleware/auth.js';
import { fetchGuildCached, fetchMemberCached } from '../../utils/discordCache.js';

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

// Main dashboard route
router.get('/', async (req, res) => {
  if (!req.user) {
    // 세션이 아직 없을 때 OAuth를 자동 시작하면 실패 시 무한 리다이렉트가 발생할 수 있습니다.
    return res.status(200).send(`
      <!doctype html>
      <html lang="ko">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>로그인 | 자판기</title>
          <link rel="stylesheet" href="/css/style.css">
        </head>
        <body>
          <main class="auth-page">
            <section class="auth-card card" aria-labelledby="login-title">
              <div class="auth-brand">
                <div class="auth-mark" aria-hidden="true">V</div>
                <div>
                  <p class="auth-eyebrow">VENDING SERVICE</p>
                  <p class="auth-brand-name">자판기 대시보드</p>
                </div>
              </div>

              <div class="auth-card-content">
                <p class="auth-kicker">MEMBER ACCESS</p>
                <h1 id="login-title">대시보드에 로그인하세요</h1>
                <p class="auth-description">Discord 계정으로 로그인하면 잔액, 구매 내역과 상점 서비스를 이용할 수 있습니다.</p>
                <a class="btn btn-primary btn-lg auth-login-button" href="/auth/discord">
                  <span class="auth-discord-icon" aria-hidden="true">D</span>
                  Discord로 로그인
                </a>
              </div>

              <p class="auth-footnote">안전한 Discord OAuth 인증을 사용합니다.</p>
            </section>
          </main>
        </body>
      </html>
    `);
  }
  
  const isAdminUser = await isServerAdmin(req);
  
  // 관리자면 admin 대시보드로
  if (isAdminUser) {
    return res.redirect('/admin');
  }
  
  // SERVER_ID가 설정되어 있으면 해당 서버에 가입되어 있는지 확인
  const serverId = process.env.SERVER_ID;
  if (serverId) {
    const client = req.app.locals.client;
    if (client && client.isReady()) {
      try {
        const guild = await fetchGuildCached(client, serverId);
        const member = await fetchMemberCached(guild, req.user.id).catch(() => null);
        
        if (!member) {
          // 서버에 없는 유저 - 서버 링크 안내 (DB에서 가져옴)
          const serverLinkSetting = await prisma.systemSetting.findUnique({
            where: { key: 'SERVER_LINK' }
          });
          return res.render('server_required', {
            user: req.user,
            serverLink: serverLinkSetting?.value || null
          });
        }
      } catch (error) {
        console.error('서버 확인 오류:', error);
      }
    }
  }
  
  res.render('user/dashboard', {
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
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    
    const [monthlyReceipts, monthlyPayments, topProducts, yearlyReceipts] = await Promise.all([
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
      }),
      prisma.receipt.findMany({
        where: { purchasedAt: { gte: yearAgo } },
        select: { paidAmount: true, purchasedAt: true }
      })
    ]);
    
    // 1년치 월별 데이터 생성 (1월~12월 고정 순서)
    const currentYear = now.getFullYear();
    const monthlyData = {};
    for (let i = 1; i <= 12; i++) {
      const key = `${currentYear}-${String(i).padStart(2, '0')}`;
      monthlyData[key] = { amount: 0, count: 0 };
    }
    
    yearlyReceipts.forEach(r => {
      const key = r.purchasedAt.toISOString().substring(0, 7);
      if (monthlyData[key]) {
        monthlyData[key].amount += r.paidAmount;
        monthlyData[key].count++;
      }
    });
    
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
      })),
      monthlyData
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
  
  // Discord 클라이언트로 역할 이름 가져오기
  const client = req.app.locals.client;
  const serverId = process.env.SERVER_ID;
  
  if (client && client.isReady() && serverId) {
    try {
      const guild = await fetchGuildCached(client, serverId);
      const rolesWithNames = await Promise.all(roles.map(async (role) => {
        try {
          const discordRole = await guild.roles.fetch(role.roleId);
          return {
            ...role,
            roleName: discordRole ? discordRole.name : '알 수 없음'
          };
        } catch {
          return { ...role, roleName: '역할 없음' };
        }
      }));
      return res.json(rolesWithNames);
    } catch (e) {
      console.error('역할 이름 가져오기 실패:', e);
    }
  }
  
  res.json(roles.map(r => ({ ...r, roleName: null })));
});

router.post('/api/admin/roles', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { spentLimit, roleId, discountRate } = req.body;
    const role = await prisma.roleReward.create({
      data: {
        spentLimit: parseInt(spentLimit),
        roleId,
        discountRate: parseInt(discountRate) || 0
      }
    });
    res.json(role);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create role reward' });
  }
});

router.delete('/api/admin/roles/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await prisma.roleReward.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete role reward' });
  }
});

export default router;
