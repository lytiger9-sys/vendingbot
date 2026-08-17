import express from 'express';
import {
  client,
  prisma,
} from '../../index.js';
import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get all categories with products
router.get('/', async (req, res) => {
  const categories = await prisma.category.findMany({
    include: {
      products: {
        orderBy: { id: 'asc' },
        include: {
          stocks: { where: { isSold: false } }
        }
      }
    },
    orderBy: { id: 'asc' }
  });
  res.json(categories);
});

// Create category
router.post('/categories', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    const category = await prisma.category.create({
      data: { name }
    });
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Delete category
router.delete('/categories/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

function isRestockCandidate(product, now = new Date()) {
  if (product.isFixed) {
    return Boolean(product.createdAt && !product.lastRestockLoggedAt);
  }

  return product.inventoryChanges.some(change =>
    change.source === 'ADMIN' &&
    (!product.lastRestockLoggedAt || change.createdAt > product.lastRestockLoggedAt) &&
    change.createdAt <= now
  );
}

function buildRestockPayload(products) {
  const productList = products
    .map(product => `- **${product.name}**`)
    .join('\n');

  const container = new ContainerBuilder()
    .setAccentColor(0x2ECC71)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 제품 입고'),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `아래 제품들이 입고되었습니다.\n\n${productList}`,
      ),
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '재고들은 입고 직후 품질이 가장 좋으니 많은 구매 부탁드립니다.\n\n@everyone',
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: ['everyone'] },
  };
}

// Get products that have changed through admin inventory actions since the last restock log.
router.get('/restock-candidates', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        stocks: { where: { isSold: false } },
        inventoryChanges: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = new Date();
    const candidates = products
      .filter(product => isRestockCandidate(product, now))
      .map(product => ({
        id: product.id,
        name: product.name,
        categoryName: product.category.name,
        isFixed: product.isFixed,
        stockCount: product.isFixed ? null : product.stocks.length,
        lastRestockLoggedAt: product.lastRestockLoggedAt,
      }));

    res.json(candidates);
  } catch (error) {
    console.error('Failed to load restock candidates:', error);
    res.status(500).json({ error: 'Failed to load restock candidates' });
  }
});

// Send a selected restock log and advance each selected product's restock checkpoint.
router.post('/restock-log', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: '제품을 하나 이상 선택해주세요.' });
    }

    const channelSetting = await prisma.systemSetting.findUnique({
      where: { key: 'RESTOCK_LOG_CHANNEL' },
    });
    const channelId = String(channelSetting?.value || '').trim();
    if (!/^\d{15,22}$/.test(channelId)) {
      return res.status(400).json({ error: '설정 페이지에서 입고 로그 채널 ID를 먼저 설정해주세요.' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: [...new Set(productIds)] } },
      include: {
        inventoryChanges: { orderBy: { createdAt: 'asc' } },
      },
    });
    const now = new Date();
    const eligibleProducts = products.filter(product => isRestockCandidate(product, now));
    if (eligibleProducts.length === 0) {
      return res.status(400).json({ error: '새로운 관리자 재고 변경이 있는 제품이 없습니다.' });
    }

    const channel = await client.channels.fetch(String(channelId)).catch(() => null);
    if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
      return res.status(400).json({ error: '메시지를 보낼 수 있는 채널을 찾을 수 없습니다.' });
    }

    await channel.send(buildRestockPayload(eligibleProducts));
    await Promise.all(eligibleProducts.map(product =>
      prisma.product.update({
        where: { id: product.id },
        data: { lastRestockLoggedAt: now },
      })
    ));

    res.json({
      success: true,
      sentProductIds: eligibleProducts.map(product => product.id),
      sentProductNames: eligibleProducts.map(product => product.name),
    });
  } catch (error) {
    console.error('Failed to send restock log:', error);
    res.status(500).json({ error: '입고 메시지를 보내는 중 오류가 발생했습니다.' });
  }
});

// Create product
router.post('/', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name, price, description, isFixed, fixedContent, categoryId, discountRate } = req.body;
    const product = await prisma.product.create({
      data: {
        name,
        price: parseInt(price),
        description,
        isFixed: isFixed === 'true' || isFixed === true,
        fixedContent: isFixed === 'true' || isFixed === true ? fixedContent : null,
        categoryId,
        discountRate: parseInt(discountRate) || 0
      }
    });
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Update product
router.put('/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { name, price, description, isFixed, fixedContent, categoryId, discountRate } = req.body;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        name,
        price: parseInt(price),
        description,
        isFixed: isFixed === 'true' || isFixed === true,
        fixedContent: isFixed === 'true' || isFixed === true ? fixedContent : null,
        categoryId,
        discountRate: parseInt(discountRate) || 0
      }
    });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product
router.delete('/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// Add stock to product
router.post('/:id/stocks', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { content } = req.body;
    const stock = await prisma.stock.create({
      data: {
        productId: req.params.id,
        content
      }
    });
    await prisma.inventoryChange.create({
      data: {
        productId: req.params.id,
        delta: 1,
        source: 'ADMIN',
      },
    });
    res.json(stock);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add stock' });
  }
});

// Delete stock
router.delete('/stocks/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const stock = await prisma.stock.findUnique({ where: { id: req.params.id } });
    if (!stock) {
      return res.status(404).json({ error: 'Stock not found' });
    }
    const wasSold = stock.isSold;
    await prisma.stock.delete({ where: { id: req.params.id } });
    if (!wasSold) {
      await prisma.inventoryChange.create({
        data: {
          productId: stock.productId,
          delta: -1,
          source: 'ADMIN',
        },
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete stock' });
  }
});

export default router;
