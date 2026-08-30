import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { processPurchase } from './purchaseProcessor.js';
import { upsertChargeLog } from '../../utils/paymentLogger.js';
import { sendReviewWebhook } from '../../utils/reviewWebhook.js';

export async function handleModalSubmit(interaction, client, prisma) {
  const { customId } = interaction;

  // 입금 신청 모달
  if (customId === 'modal_deposit') {
    // 입력값 파싱 자체는 동기 작업이라 defer 전에 해도 안전
    const senderName = interaction.fields.getTextInputValue('deposit_sender');
    const amountInput = interaction.fields.getTextInputValue('deposit_amount');
    const amount = parseInt(amountInput);

    // ⚠️ 이 아래로 DB 조회(systemSetting, user.upsert, payment.create,
    // upsertChargeLog, 계좌 설정 3건)가 최소 6번 이어지므로, 3초 제한에
    // 걸리지 않도록 무거운 작업 전에 즉시 defer한다.
    await interaction.deferReply({ ephemeral: true });

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

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    // 금액 유효성 검사
    if (isNaN(amount) || amountInput.trim() === '') {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **입금 금액에는 숫자만 입력해주세요.**')
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    // 최소 금액 체크
    if (amount < minAmount) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`💰 **최소 입금 금액은 ${minAmount.toLocaleString()}원 이상이어야 합니다.**`)
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    // 유저가 웹 대시보드 로그인 없이 디스코드에서만 입금 신청을 하는 경우,
    // User 레코드가 아예 없을 수 있으므로 결제 생성 전에 반드시 보장해준다.
    // (이게 없으면 자동충전 매칭 성공 시 paymentProcessor.js의 tx.user.update가
    //  P2025 "Record to update not found"로 실패함)
    await prisma.user.upsert({
      where: { id: interaction.user.id },
      update: {},
      create: {
        id: interaction.user.id,
        username: interaction.user.username,
        avatar: interaction.user.avatar,
        balance: 0,
        totalSpent: 0,
        blacklisted: false
      }
    });

    // 대기 중인 결제 생성
    const payment = await prisma.payment.create({
      data: {
        userId: interaction.user.id,
        amount,
        points: amount,
        senderName: senderName.trim(),
        status: 'PENDING',
        // paymentProcessor.js의 자동충전 매칭 쿼리가 type: 'AUTO'로 필터링하므로
        // 반드시 명시해야 한다. 빠지면 SMS 웹훅이 들어와도 pendingPayments가
        // 항상 0건으로 조회되어 자동충전이 매번 실패한다.
        type: 'AUTO',
        // 나중에(자동충전 완료/만료 시) 이 신청 응답 메시지를 수정하기 위해
        // interaction.token을 저장해둔다. 15분간만 유효하지만 자동충전
        // 윈도우(5분)보다 여유 있게 커버된다.
        interactionToken: interaction.token
      }
    });

    // 충전 로그 채널에 대기중 상태로 최초 기록
    await upsertChargeLog(client, prisma, payment);

    // 계좌 정보 가져오기 (은행명/계좌번호/예금주명 각각 별도 설정값)
    const [bankNameSetting, accountNumberSetting, accountHolderSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'BANK_NAME' } }),
      prisma.systemSetting.findUnique({ where: { key: 'ACCOUNT_NUMBER' } }),
      prisma.systemSetting.findUnique({ where: { key: 'ACCOUNT_HOLDER' } })
    ]);

    const bankName = bankNameSetting?.value || '미설정';
    const accountNumber = accountNumberSetting?.value || '미설정';
    const accountHolder = accountHolderSetting?.value || '미설정';

    const container = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## 💳 계좌 충전\n\n` +
          `- 은행명: \`${bankName}\`\n` +
          `- 계좌번호: \`${accountNumber}\`\n` +
          `- 예금주명: \`${accountHolder}\`\n` +
          `- 입금자명: \`${senderName}\`\n` +
          `- 입금 금액: \`${amount.toLocaleString()}\` 원`
        )
      );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }

  // 구매 수량 모달
  if (customId.startsWith('modal_purchase_')) {
    const productId = customId.split('_')[2];
    const lockKey = `${interaction.user.id}_${productId}`;

    // 중복 클릭 방지 (아직 DB 조회 전이라 3초 예산을 쓰지 않으므로 defer 전에 처리해도 안전)
    if (global.purchaseLock && global.purchaseLock.has(lockKey)) {
      return interaction.reply({
        content: '⏳ 이미 구매가 진행 중입니다. 잠시만 기다려주세요.',
        ephemeral: true
      });
    }

    if (!global.purchaseLock) global.purchaseLock = new Map();
    global.purchaseLock.set(lockKey, true);
    setTimeout(() => global.purchaseLock.delete(lockKey), 5000);

    // ⚠️ 여기서부터 DB 조회(product, user)와 processPurchase 내부의
    // 디스코드 API 호출(guild.members.fetch, DM 발송, 역할 지급, 로그 전송)이
    // 이어지므로, 3초 제한에 걸리지 않도록 무거운 작업 전에 즉시 defer한다.
    // defer 이후에는 응답 기한이 15분으로 늘어난다.
    await interaction.deferReply({ ephemeral: true });

    const qtyInput = interaction.fields.getTextInputValue('purchase_qty');
    const qty = parseInt(qtyInput);

    // 수량 유효성 검사
    if (isNaN(qty) || qty < 1) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **올바른 수량을 입력해주세요. (1이상의 숫자)**')
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
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

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    if (qty > product.stocks.length) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`❌ **재고가 부족합니다.**\n\n요청: ${qty}개\n남은 재고: ${product.stocks.length}개`)
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
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

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    // 구매 처리 (interaction은 이미 deferred 상태이므로 processPurchase/replyContainer가 editReply를 사용함)
    await processPurchase(interaction, productId, prisma, client, qty, lockKey);
    return;
  }

  // 후기 작성 모달 (디스코드에서 작성)
  if (customId.startsWith('modal_review_')) {
    const receiptId = customId.replace('modal_review_', '');

    const ratingInput = interaction.fields.getTextInputValue('review_rating');
    const content = interaction.fields.getTextInputValue('review_content');
    const rating = parseInt(ratingInput, 10);

    // ⚠️ 이 아래로 DB 조회 2번 + update 1번 + 외부 웹훅 호출이 이어지므로
    // 3초 제한에 걸리지 않도록 무거운 작업 전에 즉시 defer한다.
    await interaction.deferReply({ ephemeral: true });

    // 평점 유효성 검사 (1~5 정수)
    if (isNaN(rating) || rating < 1 || rating > 5) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **평점은 1~5 사이의 숫자로 입력해주세요.**')
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    // 후기 내용 유효성 검사
    if (!content || content.trim() === '') {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **후기 내용을 입력해주세요.**')
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    // 본인 구매 내역이 맞는지, 이미 작성한 후기가 아닌지 확인
    const receipt = await prisma.receipt.findFirst({
      where: { id: receiptId, userId: interaction.user.id },
      include: { product: true }
    });

    if (!receipt) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **구매 내역을 찾을 수 없습니다.**')
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    if (receipt.hasReview) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **이미 후기를 작성한 구매 내역입니다.**')
        );

      return interaction.editReply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }

    await prisma.receipt.update({
      where: { id: receiptId },
      data: {
        hasReview: true,
        reviewRating: rating,
        reviewContent: content.trim()
      }
    });

    // 후기 채널에도 동일하게 전송 (웹에서 작성했을 때와 동일한 로직 재사용)
    await sendReviewWebhook(interaction.user, receipt, rating, content.trim(), client);

    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const container = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ✅ 후기가 등록되었습니다\n\n**상품:** ${receipt.product?.name || '알 수 없음'}\n**평점:** ${stars}\n**내용:** ${content.trim()}`
        )
      );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }
}
