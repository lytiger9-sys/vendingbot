import { Events, ContainerBuilder, TextDisplayBuilder, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
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
    if (interaction.isStringSelectMenu()) {
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
    
    const senderInput = new TextInputBuilder({
      customId: 'deposit_sender',
      label: '입금자명',
      style: TextInputStyle.Short,
      placeholder: '입금자명을 적어주세요',
      required: true
    });
    
    const amountInput = new TextInputBuilder({
      customId: 'deposit_amount',
      label: '입금 금액',
      style: TextInputStyle.Short,
      placeholder: '숫자만 입력하세요',
      required: true
    });
    
    modal.addComponents(
      new ActionRowBuilder({ components: [senderInput] }),
      new ActionRowBuilder({ components: [amountInput] })
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
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **등록된 카테고리가 없습니다.**')
        );
      
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }
    
    const options = categories.map(cat => ({
      label: cat.name,
      value: cat.id.toString()
    }));
    
    const selectMenu = new ActionRowBuilder({
      components: [
        new StringSelectMenuBuilder({
          customId: 'select_category',
          placeholder: '카테고리를 선택하세요',
          options: options
        })
      ]
    });
    
    // V2 Container 사용
    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('👋 **카테고리를 선택해주세요**')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(selectMenu);
    
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }
  
  // 내정보 버튼
  if (customId === 'btn_my_info') {
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    const balance = (user?.balance || 0).toLocaleString();
    const totalSpent = (user?.totalSpent || 0).toLocaleString();
    
    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`# 👤 내 정보\n\n**💰 잔액:** ${balance}원\n**📊 총 지출:** ${totalSpent}원`)
      );
    
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
    return;
  }
  
  // 후기 버튼
  if (customId === 'btn_review_info') {
    const container = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## ⭐ 후기 작성\n후기 작성 시 적립금 추가 혜택을 대시보드에서 확인하세요!')
      )
      .addActionRowComponents(
        new ActionRowBuilder({
          components: [
            new ButtonBuilder({
              label: '대시보드 열기',
              style: ButtonStyle.Link,
              url: process.env.DASHBOARD_URL || 'http://localhost:3000'
            })
          ]
        })
      );
    
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
    return;
  }
  
  // 홈페이지 버튼
  if (customId === 'btn_website') {
    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('👋 아래 버튼을 눌러 홈페이지로 이동하세요.')
      )
      .addActionRowComponents(
        new ActionRowBuilder({
          components: [
            new ButtonBuilder({
              label: '홈페이지로 이동',
              style: ButtonStyle.Link,
              url: process.env.DASHBOARD_URL || 'http://localhost:3000'
            })
          ]
        })
      );
    
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }
  
  // 구매 버튼
  if (customId.startsWith('buy_product_')) {
    const productId = parseInt(customId.split('_')[2]);
    await processPurchase(interaction, productId, prisma, client);
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
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **해당 카테고리에 상품이 없습니다.**')
        );
      
      return interaction.update({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }
    
    const options = products.map(p => ({
      label: `${p.name} - ${p.price.toLocaleString()}원`,
      value: p.id.toString(),
      description: p.description?.substring(0, 50) || '설명 없음'
    }));
    
    const selectMenu = new ActionRowBuilder({
      components: [
        new StringSelectMenuBuilder({
          customId: 'select_product',
          placeholder: '상품을 선택하세요',
          options: options
        })
      ]
    });
    
    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('👋 **상품을 선택해주세요**')
      )
      .addActionRowComponents(selectMenu);
    
    await interaction.update({
      components: [container],
      flags: MessageFlags.IsComponentsV2
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
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **상품을 찾을 수 없습니다.**')
        );
      
      return interaction.update({
        components: [container],
        flags: MessageFlags.IsComponentsV2
      });
    }
    
    const stockInfo = product.isFixed ? '무제한' : `${product.stocks.filter(s => !s.isSold).length}개`;
    const productType = product.isFixed ? '📋 고정형' : '📦 재고형';
    
    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${product.name}\n\n${product.description || '설명 없음'}\n\n**💰 가격:** ${product.price.toLocaleString()}원\n**📁 카테고리:** ${product.category.name}\n**📦 재고:** ${stockInfo}\n**🏷️ 종류:** ${productType}`)
      )
      .addActionRowComponents(
        new ActionRowBuilder({
          components: [
            new ButtonBuilder({
              customId: `buy_product_${product.id}`,
              label: '구매하기 🛒',
              style: ButtonStyle.Success
            })
          ]
        })
      );
    
    await interaction.update({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });
    return;
  }
}

async function handleModalSubmit(interaction, client, prisma) {
  const { customId } = interaction;
  
  if (customId === 'modal_deposit') {
    const senderName = interaction.fields.getTextInputValue('deposit_sender');
    const amountInput = interaction.fields.getTextInputValue('deposit_amount');
    const amount = parseInt(amountInput);
    
    // 최소 입금 금액 먼저 가져오기
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
    
    // 금액 유효성 검사 - 숫자가 아닌 경우
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
    
    // 금액이 최소금액 미만인 경우
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
          `# 💰 입금 신청 완료\n\n신청이 완료되었습니다. 입금 확인 후 포인트가 충전됩니다.\n\n**👤 입금자명:** ${senderName}\n**💵 입금 금액:** ${amount.toLocaleString()}원\n\n**🏦 계좌정보:**\n${bankSetting?.value || '설정된 계좌정보 없음'}`
        )
      );
    
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
  }
}

async function processPurchase(interaction, productId, prisma) {
  try {
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    
    if (!user) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **사용자를 찾을 수 없습니다.**')
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
          new TextDisplayBuilder().setContent('🚫 **블랙리스트 처리된 사용자입니다.**')
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
          new TextDisplayBuilder().setContent('❌ **상품을 찾을 수 없습니다.**')
        );
      
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }
    
    if (product.price > user.balance) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`💸 **잔액이 부족합니다.**\n\n필요: ${product.price.toLocaleString()}원\n보유: ${user.balance.toLocaleString()}원`)
        );
      
      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
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
        const container = new ContainerBuilder()
          .setAccentColor(0xFF5555)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('💔 **재고가 부족합니다.**')
          );
        
        return interaction.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
          ephemeral: true
        });
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
      const dmEmbed = new TextDisplayBuilder()
        .setContent(
          `# ✅ 구매 완료: ${product.name}\n\n구매가 완료되었습니다! 아래 정보를 확인하세요!\n\n**📦 상품명:** ${product.name}\n**💵 결제 금액:** ${product.price.toLocaleString()}원\n**🕐 구매 일시:** ${new Date().toLocaleString('ko-KR')}\n\n**🎁 전달된 상품:**\n${deliveredContent}`
        );
      
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
    
    // 구매자에게 확인
    const successContainer = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('✅ **구매가 완료되었습니다!**\n📦 전달된 정보는 DM으로 발송되었습니다.')
      );
    
    await interaction.reply({
      components: [successContainer],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
    
  } catch (error) {
    console.error('Purchase error:', error);
    const container = new ContainerBuilder()
      .setAccentColor(0xFF5555)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('❌ **구매 처리 중 오류가 발생했습니다.**')
      );
    
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
  }
}
