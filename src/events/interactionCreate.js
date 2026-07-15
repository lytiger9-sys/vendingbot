import { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { prisma } from '../index.js';
import { checkAndGiveRole } from '../utils/roleManager.js';

export default {
  name: Events.InteractionCreate,
  once: false,
  async execute(interaction, client) {
    // 슬래시 명령어
    if (interaction.isChatInputCommand()) {
      const command = client.slashCommands.get(interaction.commandName);
      if (!command) return;
      
      try {
        await command.execute(interaction, client, prisma);
      } catch (error) {
        console.error('Command error:', error);
        await interaction.reply({ content: '명령어 처리 중 오류가 발생했습니다.', ephemeral: true });
      }
      return;
    }
    
    // 버튼 인터랙션
    if (interaction.isButton()) {
      await handleButton(interaction, client, prisma);
      return;
    }
    
    // 셀렉트 메뉴 인터랙션
    if (interaction.isSelectMenu()) {
      await handleSelectMenu(interaction, client, prisma);
      return;
    }
    
    // 모달 제출 인터랙션
    if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction, client, prisma);
      return;
    }
  }
};

async function handleButton(interaction, client, prisma) {
  const { customId } = interaction;
  
  // 입금 버튼
  if (customId === 'btn_deposit') {
    const modal = new ModalBuilder()
      .setCustomId('modal_deposit')
      .setTitle('💰 입금 신청');
    
    const senderInput = new TextInputBuilder()
      .setCustomId('deposit_sender')
      .setLabel('입금자명')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('적요 혹은 계좌주인을 입력하세요')
      .setRequired(true);
    
    const amountInput = new TextInputBuilder()
      .setCustomId('deposit_amount')
      .setLabel('입금 금액')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('숫자만 입력하세요')
      .setRequired(true);
    
    modal.addComponents(
      new ActionRowBuilder().addComponents(senderInput),
      new ActionRowBuilder().addComponents(amountInput)
    );
    
    await interaction.showModal(modal);
    return;
  }
  
  // 상품 버튼
  if (customId === 'btn_products') {
    const categories = await prisma.category.findMany({
      include: { products: true }
    });
    
    if (categories.length === 0) {
      return interaction.reply({
        content: '등록된 카테고리가 없습니다.',
        ephemeral: true
      });
    }
    
    const options = categories.map(cat => ({
      label: cat.name,
      value: cat.id.toString()
    }));
    
    const selectMenu = new ActionRowBuilder().addComponents({
      type: 3,
      customId: 'select_category',
      placeholder: '카테고리를 선택하세요',
      options: options
    });
    
    await interaction.reply({
      content: '👋 **카테고리를 선택해주세요**',
      components: [selectMenu],
      ephemeral: true
    });
    return;
  }
  
  // 내정보 버튼
  if (customId === 'btn_my_info') {
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    const embed = new EmbedBuilder()
      .setTitle('👤 내 정보')
      .setColor('#5865F2')
      .addFields(
        { name: '잔액', value: `${(user?.balance || 0).toLocaleString()}원`, inline: true },
        { name: '총 지출', value: `${(user?.totalSpent || 0).toLocaleString()}원`, inline: true }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }
  
  // 후기 버튼
  if (customId === 'btn_review_info') {
    const embed = new EmbedBuilder()
      .setTitle('⭐ 후기 작성')
      .setDescription('후기 작성 시 적립금 추가 혜택을 대시보드에서 확인하세요!')
      .setColor('#00FF00');
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('대시보드 열기')
        .setStyle(ButtonStyle.Link)
        .setURL(process.env.DASHBOARD_URL || 'http://localhost:3000')
    );
    
    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    return;
  }
  
  // 홈페이지 버튼
  if (customId === 'btn_website') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('홈페이지로 이동')
        .setStyle(ButtonStyle.Link)
        .setURL(process.env.DASHBOARD_URL || 'http://localhost:3000')
    );
    
    await interaction.reply({
      content: '👋 아래 버튼을 눌러 홈페이지로 이동하세요.',
      components: [row],
      ephemeral: true
    });
    return;
  }
  
  // 구매 버튼
  if (customId.startsWith('buy_product_')) {
    const productId = parseInt(customId.split('_')[2]);
    await processPurchase(interaction, productId, prisma);
    return;
  }
}

async function handleSelectMenu(interaction, client, prisma) {
  const { customId, values } = interaction;
  
  // 카테고리 선택
  if (customId === 'select_category') {
    const categoryId = parseInt(values[0]);
    const products = await prisma.product.findMany({
      where: { categoryId },
      include: { category: true }
    });
    
    if (products.length === 0) {
      return interaction.reply({
        content: '해당 카테고리에 상품이 없습니다.',
        ephemeral: true
      });
    }
    
    const options = products.map(p => ({
      label: `${p.name} - ${p.price.toLocaleString()}원`,
      value: p.id.toString(),
      description: p.description?.substring(0, 50) || '설명 없음'
    }));
    
    const selectMenu = new ActionRowBuilder().addComponents({
      type: 3,
      customId: 'select_product',
      placeholder: '상품을 선택하세요',
      options: options
    });
    
    await interaction.update({
      content: '👋 **상품을 선택해주세요**',
      components: [selectMenu]
    });
    return;
  }
  
  // 상품 선택
  if (customId === 'select_product') {
    const productId = parseInt(values[0]);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true, stocks: true }
    });
    
    if (!product) {
      return interaction.reply({
        content: '상품을 찾을 수 없습니다.',
        ephemeral: true
      });
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`${product.name}`)
      .setColor('#5865F2')
      .setDescription(product.description || '설명 없음')
      .addFields(
        { name: '가격', value: `${product.price.toLocaleString()}원`, inline: true },
        { name: '카테고리', value: product.category.name, inline: true },
        { name: '재고', value: product.isFixed ? '무제한' : `${product.stocks.filter(s => !s.isSold).length}개`, inline: true },
        { name: '종류', value: product.isFixed ? '📋 고정형' : '📦 재고형', inline: true }
      )
      .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_product_${product.id}`)
        .setLabel('구매하기')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🛒')
    );
    
    await interaction.update({
      embeds: [embed],
      components: [row]
    });
    return;
  }
}

async function handleModalSubmit(interaction, client, prisma) {
  const { customId } = interaction;
  
  if (customId === 'modal_deposit') {
    const senderName = interaction.fields.getTextInputValue('deposit_sender');
    const amount = parseInt(interaction.fields.getTextInputValue('deposit_amount'));
    
    // 최소 입금 금액 가져오기
    const minDeposit = await prisma.systemSetting.findUnique({
      where: { key: 'MIN_DEPOSIT' }
    });
    const minAmount = minDeposit ? parseInt(minDeposit.value) : 1000;
    
    if (amount < minAmount) {
      return interaction.reply({
        content: `💰 최소 입금 금액은 ${minAmount.toLocaleString()}원입니다.`,
        ephemeral: true
      });
    }
    
    // 대기 중인 결제 생성
    await prisma.payment.create({
      data: {
        userId: interaction.user.id,
        amount,
        points: amount,
        senderName,
        status: 'PENDING'
      }
    });
    
    // 계좌 정보 가져오기
    const bankSetting = await prisma.systemSetting.findUnique({
      where: { key: 'BANK_INFO' }
    });
    
    const embed = new EmbedBuilder()
      .setTitle('💰 입금 신청 완료')
      .setColor('#00FF00')
      .setDescription('신청이 완료되었습니다. 입금 확인 후 포인트가 충전됩니다.')
      .addFields(
        { name: '입금자명', value: senderName, inline: true },
        { name: '입금 금액', value: `${amount.toLocaleString()}원`, inline: true },
        { name: '계좌정보', value: bankSetting?.value || '설정된 계좌정보 없음', inline: false }
      )
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

async function processPurchase(interaction, productId, prisma) {
  try {
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    
    if (!user) {
      return interaction.reply({ content: '사용자를 찾을 수 없습니다.', ephemeral: true });
    }
    
    if (user.blacklisted) {
      return interaction.reply({ content: '블랙리스트 처리된 사용자입니다.', ephemeral: true });
    }
    
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { stocks: { where: { isSold: false } } }
    });
    
    if (!product) {
      return interaction.reply({ content: '상품을 찾을 수 없습니다.', ephemeral: true });
    }
    
    if (product.price > user.balance) {
      return interaction.reply({
        content: `💸 잔액이 부족합니다. (필요: ${product.price.toLocaleString()}원, 보유: ${user.balance.toLocaleString()}원)`,
        ephemeral: true
      });
    }
    
    let deliveredContent = '';
    
    if (product.isFixed) {
      // 고정형 - 모든 콘텐츠 전송
      deliveredContent = product.fixedContent || product.description || '상품 정보 없음';
    } else {
      // 재고형 - 랜덤 한 개 가져오기
      if (product.stocks.length === 0) {
        return interaction.reply({ content: '💔 재고가 부족합니다.', ephemeral: true });
      }
      
      const randomStock = product.stocks[Math.floor(Math.random() * product.stocks.length)];
      await prisma.stock.update({
        where: { id: randomStock.id },
        data: { isSold: true }
      });
      deliveredContent = randomStock.content;
    }
    
    // 사용자 잔액 업데이트
    await prisma.user.update({
      where: { id: interaction.user.id },
      data: {
        balance: user.balance - product.price,
        totalSpent: user.totalSpent + product.price
      }
    });
    
    // 구매 영수증 생성
    const receipt = await prisma.receipt.create({
      data: {
        userId: interaction.user.id,
        productId: product.id,
        paidAmount: product.price,
        deliveredContent
      }
    });
    
    // DM 전송
    try {
      const dmEmbed = new EmbedBuilder()
        .setTitle(`✅ 구매 완료: ${product.name}`)
        .setColor('#00FF00')
        .setDescription('구매가 완료되었습니다! 아래 정보를 확인하세요!')
        .addFields(
          { name: '상품명', value: product.name, inline: true },
          { name: '결제 금액', value: `${product.price.toLocaleString()}원`, inline: true },
          { name: '구매 일시', value: new Date().toLocaleString('ko-KR'), inline: false }
        )
        .addFields({ name: '🎁 전달된 상품', value: deliveredContent })
        .setTimestamp();
      
      await interaction.user.send({ embeds: [dmEmbed] });
    } catch (dmError) {
      console.log('DM failed, content saved to receipt');
    }
    
    // 역할 확인 및 부여
    await checkAndGiveRole(interaction.user.id, prisma, client);
    
    // 구매자에게 확인
    await interaction.reply({
      content: `✅ **구매가 완료되었습니다!**\n📦 전달된 정보는 DM으로 발송되었습니다.`,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Purchase error:', error);
    await interaction.reply({ content: '구매 처리 중 오류가 발생했습니다.', ephemeral: true });
  }
}
