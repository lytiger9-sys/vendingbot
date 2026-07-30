import { ContainerBuilder, TextDisplayBuilder, MessageFlags, TextDisplayBuilder as TextDisplay } from 'discord.js';
import { checkAndGiveRole } from '../../utils/roleManager.js';

export async function processPurchase(interaction, productId, prisma, client, quantity = 1, lockKey = null) {
  try {
    // SERVER_ID 검증
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent('이 서버에서는 사용할 수 없습니다.')
        );
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }
    
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });

    if (!user) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent('❌ **사용자를 찾을 수 없습니다.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    if (user.blacklisted) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent('🚫 **블랙리스트 처리된 사용자입니다.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { stocks: { where: { isSold: false } } }
    });

    if (!product) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent('❌ **상품을 찾을 수 없습니다.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    const totalPrice = product.price * quantity;

    if (totalPrice > user.balance) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent(`💸 **잔액이 부족합니다.**\n\n필요: ${totalPrice.toLocaleString()}원\n보유: ${user.balance.toLocaleString()}원`)
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 재고형 재고 검증
    if (!product.isFixed && product.stocks.length < quantity) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent(`💔 **재고가 부족합니다.**\n\n요청: ${quantity}개\n남은 재고: ${product.stocks.length}개`)
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    let deliveredContents = [];

    // 재고형일 경우 트랜잭션으로 재고 확인 및 차감
    if (!product.isFixed) {
      const shuffled = [...product.stocks].sort(() => Math.random() - 0.5);
      const selectedStocks = shuffled.slice(0, quantity);
      const selectedStockIds = selectedStocks.map(s => s.id);

      await prisma.$transaction(async (tx) => {
        const currentStocks = await tx.stock.findMany({
          where: {
            id: { in: selectedStockIds },
            isSold: false
          }
        });

        if (currentStocks.length < quantity) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        await tx.stock.updateMany({
          where: { id: { in: selectedStockIds } },
          data: { isSold: true }
        });

        deliveredContents = currentStocks.map(s => s.content);
      });
    } else {
      deliveredContents.push(product.fixedContent || product.description || '상품 정보 없음');
    }

    const deliveredContent = deliveredContents.join('\n---\n');

    // 사용자 잔액 업데이트
    await prisma.user.update({
      where: { id: interaction.user.id },
      data: {
        balance: user.balance - totalPrice,
        totalSpent: user.totalSpent + totalPrice
      }
    });

    // 구매 영수증 생성
    for (let i = 0; i < quantity; i++) {
      await prisma.receipt.create({
        data: {
          userId: interaction.user.id,
          productId: product.id,
          paidAmount: product.price,
          deliveredContent: product.isFixed ? deliveredContent : deliveredContents[i] || deliveredContent
        }
      });
    }

    // DM 전송
    try {
      const dmContent = `✅ 구매 완료: ${product.name}\n\n구매가 완료되었습니다!\n\n**상품명:** ${product.name}\n**구매수량:** ${quantity}개\n**결제금액:** ${totalPrice.toLocaleString()}원\n\n**🎁 전달된 상품:**\n${deliveredContent}`;

      const dmEmbed = new TextDisplay().setContent(dmContent);
      const dmContainer = new ContainerBuilder()
        .setAccentColor(0x00FF00)
        .addTextDisplayComponents(dmEmbed);

      await interaction.user.send({
        components: [dmContainer],
        flags: MessageFlags.IsComponentsV2
      });
    } catch (dmError) {
      console.log('DM failed, content saved to receipt');
    }

    // 역할 확인 및 부여
    await checkAndGiveRole(interaction.user.id, prisma, client);

    // 구매 완료 응답
    const successContainer = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplay().setContent(`✅ **구매가 완료되었습니다!**\n\n상품: ${product.name}\n수량: ${quantity}개\n결제: ${totalPrice.toLocaleString()}원\n\n📦 전달된 정보는 DM으로 발송되었습니다.`)
      );

    await interaction.reply({
      components: [successContainer],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });

    // 락 해제
    if (lockKey && global.purchaseLock) {
      global.purchaseLock.delete(lockKey);
    }

  } catch (error) {
    console.error('Purchase error:', error);
    
    if (lockKey && global.purchaseLock) {
      global.purchaseLock.delete(lockKey);
    }
    
    if (error.message === 'INSUFFICIENT_STOCK') {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplay().setContent('❌ **재고가 부족합니다. 다른 사용자가 먼저 구매했습니다.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }
    
    const container = new ContainerBuilder()
      .setAccentColor(0xFF5555)
      .addTextDisplayComponents(
        new TextDisplay().setContent('❌ **구매 처리 중 오류가 발생했습니다.**')
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
  }
}