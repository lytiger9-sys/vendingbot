import express from 'express';
import { prisma } from '../../index.js';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get all categories with products
router.get('/', async (req, res) => {
  const categories = await prisma.category.findMany({
    include: {
      products: {
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
    await prisma.category.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete category' });
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
        categoryId: parseInt(categoryId),
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
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        price: parseInt(price),
        description,
        isFixed: isFixed === 'true' || isFixed === true,
        fixedContent: isFixed === 'true' || isFixed === true ? fixedContent : null,
        categoryId: parseInt(categoryId),
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
    await prisma.product.delete({ where: { id: parseInt(req.params.id) } });
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
        productId: parseInt(req.params.id),
        content
      }
    });
    res.json(stock);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add stock' });
  }
});

// Delete stock
router.delete('/stocks/:id', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await prisma.stock.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete stock' });
  }
});

export default router;