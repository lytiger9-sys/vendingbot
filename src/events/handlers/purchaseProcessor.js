import { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';
import { checkAndGiveRole } from '../../utils/roleManager.js';
import { sendPaymentLog } from '../../utils/paymentLogger.js';
import {
  calculateDiscountedAmount,
  getHighestDiscountRate,
  splitAmountAcrossQuantity,
} from '../../utils/discountCalculator.js';

async function getUserRoleDiscountRate(interaction, prisma, client) {
  const serverId = process.env.SERVER_ID;
  if (!serverId || interaction.guildId !== serverId) {
    return 0;
  }

  const guild = interaction.guild ?? await client.guilds.fetch(interaction.guildId).catch(() => null);
  if (!guild) {
    return 0;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return 0;
  }

  const userRoleIds = new Set(member.roles.cache.map(role => role.id));
  const roleRewards = await prisma.roleReward.findMany({
    select: { roleId: true, discountRate: true },
  });

  return getHighestDiscountRate(roleRewards.filter(role => userRoleIds.has(role.roleId)));
}

function buildContainer(text, color) {
  return new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

async function replyContainer(interaction, text, color = 0xFF5555) {
  const payload = {
    components: [buildContainer(text, color)],
    flags: MessageFlags.IsComponentsV2,
    ephemeral: true,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function releasePurchaseLock(lockKey) {
  if (lockKey && global.purchaseLock) {
    global.purchaseLock.delete(lockKey);
  }
}

function getDiscountLabel(productDiscountRate, roleDiscountRate) {
  const productRate = Number(productDiscountRate) || 0;
  const roleRate = Number(roleDiscountRate) || 0;

  if (productRate <= 0 && roleRate <= 0) {
    return '없음';
  }

  if (productRate > 0 && roleRate > 0) {
    return `상품 ${productRate}% → 개인 역할 ${roleRate}%`;
  }

  if (productRate > 0) {
    return `상품 ${productRate}%`;
  }

  return `개인 역할 ${roleRate}%`;
}

export async function processPurchase(interaction, productId, prisma, client, quantity = 1, lockKey = null) {
  try {
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      await replyContainer(interaction, '해당 서버에서만 사용할 수 있습니다.');
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    if (!user) {
      await replyContainer(interaction, '사용자를 찾을 수 없습니다.');
      return;
    }

    if (user.blacklisted) {
      await replyContainer(interaction, '차단된 사용자는 구매할 수 없습니다.');
      return;
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { stocks: { where: { isSold: false } } },
    });

    if (!product) {
      await replyContainer(interaction, '상품을 찾을 수 없습니다.');
      return;
    }

    const baseAmount = product.price * quantity;
    const roleDiscountRate = await getUserRoleDiscountRate(interaction, prisma, client);
    const discountResult = calculateDiscountedAmount(baseAmount, product.discountRate, roleDiscountRate);
    const totalPrice = discountResult.finalAmount;
    const discountLabel = getDiscountLabel(discountResult.productDiscountRate, discountResult.roleDiscountRate);
    const paidAmountShares = splitAmountAcrossQuantity(totalPrice, quantity);

    if (totalPrice > user.balance) {
      await replyContainer(
        interaction,
        `잔액이 부족합니다.\n\n필요: ${totalPrice.toLocaleString()}원\n보유: ${user.balance.toLocaleString()}원`
      );
      return;
    }

    if (!product.isFixed && product.stocks.length < quantity) {
      await replyContainer(
        interaction,
        `재고가 부족합니다.\n\n요청: ${quantity}개\n보유 재고: ${product.stocks.length}개`
      );
      return;
    }

    let deliveredContents = [];

    if (!product.isFixed) {
      const shuffled = [...product.stocks].sort(() => Math.random() - 0.5);
      const selectedStocks = shuffled.slice(0, quantity);
      const selectedStockIds = selectedStocks.map(stock => stock.id);

      await prisma.$transaction(async (tx) => {
        const currentStocks = await tx.stock.findMany({
          where: {
            id: { in: selectedStockIds },
            isSold: false,
          },
        });

        if (currentStocks.length < quantity) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        await tx.stock.updateMany({
          where: { id: { in: selectedStockIds } },
          data: { isSold: true },
        });

        deliveredContents = currentStocks.map(stock => stock.content);
      });
    } else {
      deliveredContents.push(product.fixedContent || product.description || '상품 정보 없음');
    }

    const deliveredContent = deliveredContents.join('\n---\n');

    await prisma.user.update({
      where: { id: interaction.user.id },
      data: {
        balance: user.balance - totalPrice,
        totalSpent: user.totalSpent + totalPrice,
      },
    });

    for (let i = 0; i < quantity; i++) {
      await prisma.receipt.create({
        data: {
          userId: interaction.user.id,
          productId: product.id,
          paidAmount: paidAmountShares[i] ?? totalPrice,
          deliveredContent: product.isFixed ? deliveredContent : deliveredContents[i] || deliveredContent,
        },
      });
    }

    try {
      const purchaseDate = new Date().toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const dmContainer = new ContainerBuilder()
        .setAccentColor(0x00FF00)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## 구매 완료: ${product.name}\n\n구매가 완료되었습니다.`)
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**상품명:** ${product.name}\n` +
            `**구매수량:** ${quantity}개\n` +
            `**원가:** ${discountResult.originalAmount.toLocaleString()}원\n` +
            `**적용 할인:** ${discountLabel}\n` +
            `**상품 할인 금액:** ${discountResult.productDiscountAmount.toLocaleString()}원\n` +
            `**개인 역할 할인 금액:** ${discountResult.roleDiscountAmount.toLocaleString()}원\n` +
            `**할인 금액 합계:** ${discountResult.discountAmount.toLocaleString()}원\n` +
            `**결제금액:** ${totalPrice.toLocaleString()}원\n` +
            `**구매일시:** ${purchaseDate}`
          )
        )
        .addSeparatorComponents(
          new SeparatorBuilder()
            .setDivider(true)
            .setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`**전달된 상품:**\n${deliveredContent}`)
        );

      await interaction.user.send({
        components: [dmContainer],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (dmError) {
      console.log('DM failed, content saved to receipt');
    }

    await checkAndGiveRole(interaction.user.id, prisma, client);

    await sendPaymentLog(client, prisma, 'PURCHASE_LOG_CHANNEL', {
      title: '구매 완료',
      color: 0x2ECC71,
      fields: [
        { name: '유저', value: `<@${interaction.user.id}>`, inline: true },
        { name: '상품', value: product.name, inline: true },
        { name: '수량', value: `${quantity}개`, inline: true },
        { name: '원가', value: `${discountResult.originalAmount.toLocaleString()}원`, inline: true },
        { name: '할인', value: discountLabel, inline: true },
        { name: '상품 할인 금액', value: `${discountResult.productDiscountAmount.toLocaleString()}원`, inline: true },
        { name: '개인 역할 할인 금액', value: `${discountResult.roleDiscountAmount.toLocaleString()}원`, inline: true },
        { name: '결제금액', value: `${totalPrice.toLocaleString()}원`, inline: true },
      ],
    });

    await interaction.reply({
      components: [
        buildContainer(
          `구매가 완료되었습니다.\n\n` +
          `상품: ${product.name}\n` +
          `수량: ${quantity}개\n` +
          `할인: ${discountLabel}\n` +
          `결제: ${totalPrice.toLocaleString()}원\n\n` +
          `전달된 정보는 DM으로 발송되었습니다.`,
          0x00FF00
        )
      ],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true,
    });
  } catch (error) {
    console.error('Purchase error:', error);

    if (error.message === 'INSUFFICIENT_STOCK') {
      await replyContainer(
        interaction,
        '재고가 부족합니다. 다른 사용자가 먼저 구매했습니다.'
      );
      return;
    }

    await replyContainer(
      interaction,
      '구매 처리 중 오류가 발생했습니다.'
    );
  } finally {
    releasePurchaseLock(lockKey);
  }
}

