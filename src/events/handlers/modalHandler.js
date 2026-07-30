import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { processPurchase } from './purchaseProcessor.js';

export async function handleModalSubmit(interaction, client, prisma) {
  const { customId } = interaction;

  // 입금 신청 모달
  if (customId === 'modal_deposit') {
    const senderName = interaction.fields.getTextInputValue('deposit_sender');
    const amountInput = interaction.fields.getTextInputValue('deposit_amount');
    const amount = parseInt(amountInput);

    // 최소 입금 금액 가져오기
    const minDeposit = await prisma.systemSetting.findUnique({
      where: { key: 'MIN_DEPOSIT' }
    });
    const minAmount = minDeposit ? parseInt(minDeposit.value) : 1000;

    // 입금자명 유효성 검사
    if (!senderName || senderName.trim() === '') {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **입금자명을 입력해주세요.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 금액 유효성 검사
    if (isNaN(amount) || amountInput.trim() === '') {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **입금 금액에는 숫자만 입력해주세요.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 최소 금액 체크
    if (amount < minAmount) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`💰 **최소 입금 금액은 ${minAmount.toLocaleString()}원 이상이어야 합니다.**`)
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 대기 중인 결제 생성
    await prisma.payment.create({
      data: {
        userId: interaction.user.id,
        amount,
        points: amount,
        senderName: senderName.trim(),
        status: 'PENDING'
      }
    });

    // 계좌 정보 가져오기
    const bankSetting = await prisma.systemSetting.findUnique({
      where: { key: 'BANK_INFO' }
    });

    const container = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# 💰 입금 신청 완료\n\n신청이 완료되었습니다. 입금 확인 후 포인트가 충전됩니다.\n\n**입금자명:** ${senderName}\n**입금 금액:** ${amount.toLocaleString()}원\n\n**계좌정보:**\n${bankSetting?.value || '설정된 계좌정보 없음'}`
        )
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
    return;
  }

  // 구매 수량 모달
  if (customId.startsWith('modal_purchase_')) {
    const productId = parseInt(customId.split('_')[2]);
    const lockKey = `${interaction.user.id}_${productId}`;
    
    // 중복 클릭 방지
    if (global.purchaseLock && global.purchaseLock.has(lockKey)) {
      return interaction.reply({
        content: '⏳ 이미 구매가 진행 중입니다. 잠시만 기다려주세요.',
        ephemeral: true
      });
    }
    
    if (!global.purchaseLock) global.purchaseLock = new Map();
    global.purchaseLock.set(lockKey, true);
    setTimeout(() => global.purchaseLock.delete(lockKey), 5000);
    
    const qtyInput = interaction.fields.getTextInputValue('purchase_qty');
    const qty = parseInt(qtyInput);

    // 수량 유효성 검사
    if (isNaN(qty) || qty < 1) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **올바른 수량을 입력해주세요. (1이상의 숫자)**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 재고 확인
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { stocks: { where: { isSold: false } } }
    });

    if (!product) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **상품을 찾을 수 없습니다.**')
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    if (qty > product.stocks.length) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`❌ **재고가 부족합니다.**\n\n요청: ${qty}개\n남은 재고: ${product.stocks.length}개`)
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 잔액 확인
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    const totalPrice = product.price * qty;

    if (totalPrice > (user?.balance || 0)) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`❌ **잔액이 부족합니다.**\n\n필요: ${totalPrice.toLocaleString()}원\n보유: ${user?.balance?.toLocaleString() || 0}원`)
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 구매 처리
    await processPurchase(interaction, productId, prisma, client, qty, lockKey);
    return;
  }
}