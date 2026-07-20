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
    // SERVER_ID 검증
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      return interaction.reply({
        content: '이 서버에서는 사용할 수 없습니다.',
        ephemeral: true
      });
    }
    
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
    // SERVER_ID 검증
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      return interaction.reply({
        content: '이 서버에서는 사용할 수 없습니다.',
        ephemeral: true
      });
    }
    
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
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
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
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
    return;
  }

  // 내정보 버튼
  if (customId === 'btn_my_info') {
    // SERVER_ID 검증
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      return interaction.reply({
        content: '이 서버에서는 사용할 수 없습니다.',
        ephemeral: true
      });
    }
    
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    const balance = (user?.balance || 0).toLocaleString();
    const totalSpent = (user?.totalSpent || 0).toLocaleString();

    // 사용자가 가진 역할 조회
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const userRoleIds = member?.roles.cache.map(r => r.id) || [];

    // 역할 보상 설정 조회
    const roleRewards = await prisma.roleReward.findMany();

    // 사용자가 가진 역할 중 보상 역할 필터링
    const userRewards = roleRewards.filter(r => userRoleIds.includes(r.roleId));

    // 역할 멘션 생성
    let rolesText = '없음';
    if (userRewards.length > 0 && member) {
      const roleMentions = userRewards.map(r => {
        const role = member.guild.roles.cache.get(r.roleId);
        return role ? `<@&${role.id}>` : null;
      }).filter(Boolean);

      if (roleMentions.length > 0) {
        rolesText = roleMentions.join(', ');
      }
    }

    // 미작성 후기 수
    const unreviewedCount = await prisma.receipt.count({
      where: {
        userId: interaction.user.id,
        hasReview: false
      }
    });

    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('# 정보')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`<@${interaction.user.id}>`)
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `잔액: ${balance}원\n` +
          `누적 구매 금액: ${totalSpent}원\n` +
          `누적 구매 역할: ${rolesText}\n` +
          `적용 할인율: 없음\n` +
          `미작성 후기: ${unreviewedCount}개`
        )
      );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
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

  // 구매 확인 버튼 (고정형)
  if (customId.startsWith('purchase_confirm_')) {
    const productId = parseInt(customId.split('_')[2]);
    await processPurchase(interaction, productId, prisma, client, 1);
    return;
  }

  // 구매 취소 버튼
  if (customId === 'purchase_cancel') {
    const container = new ContainerBuilder()
      .setAccentColor(0x666666)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('❌ **구매가 취소되었습니다.**')
      );

    return interaction.update({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
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
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
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
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
    return;
  }

  // 상품 선택
  if (customId === 'select_product') {
    const productId = parseInt(values[0]);
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true, stocks: { where: { isSold: false } } }
    });

    if (!product) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **상품을 찾을 수 없습니다.**')
        );

      return interaction.update({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    const availableStock = product.stocks.length;
    const stockInfo = product.isFixed ? '무제한' : `${availableStock}개`;

    // 재고형인 경우
    if (!product.isFixed && availableStock === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${product.name}\n\n${product.description || '설명 없음'}\n\n**가격:** ${product.price.toLocaleString()}원\n**남은 재고:** 0개\n\n❌ **재고가 없습니다.**`)
        );

      return interaction.update({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 고정형인 경우: 구매 확인/취소 버튼 표시
    if (product.isFixed) {
      const container = new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${product.name}\n\n${product.description || '설명 없음'}\n\n**가격:** ${product.price.toLocaleString()}원\n**종류:** 고정형\n\n정말 구매하시겠습니까?`)
        )
        .addActionRowComponents(
          new ActionRowBuilder({
            components: [
              new ButtonBuilder({
                customId: `purchase_confirm_${product.id}`,
                label: '구매하기',
                style: ButtonStyle.Success
              }),
              new ButtonBuilder({
                customId: `purchase_cancel`,
                label: '취소',
                style: ButtonStyle.Secondary
              })
            ]
          })
        );

      return interaction.update({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    // 재고형인 경우: 수량 선택 모달 표시
    const modal = new ModalBuilder()
      .setCustomId(`modal_purchase_${product.id}`)
      .setTitle(`${product.name} 구매`);

    const qtyInput = new TextInputBuilder({
      customId: 'purchase_qty',
      label: '구매 수량',
      style: TextInputStyle.Short,
      placeholder: `1 ~ ${availableStock}`,
      required: true
    });

    modal.addComponents(new ActionRowBuilder({ components: [qtyInput] }));
    await interaction.showModal(modal);
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
    await processPurchase(interaction, productId, prisma, client, qty);
    return;
  }
}

async function processPurchase(interaction, productId, prisma, client, quantity = 1) {
  try {
    // SERVER_ID 검증
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('이 서버에서는 사용할 수 없습니다.')
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

    const totalPrice = product.price * quantity;

    if (totalPrice > user.balance) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`💸 **잔액이 부족합니다.**\n\n필요: ${totalPrice.toLocaleString()}원\n보유: ${user.balance.toLocaleString()}원`)
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
          new TextDisplayBuilder().setContent(`💔 **재고가 부족합니다.**\n\n요청: ${quantity}개\n남은 재고: ${product.stocks.length}개`)
        );

      return interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    let deliveredContents = [];

    if (product.isFixed) {
      // 고정형 - 모든 콘텐츠 전송
      deliveredContents.push(product.fixedContent || product.description || '상품 정보 없음');
    } else {
      // 재고형 - quantity 개만큼 랜덤 가져오기
      const shuffled = [...product.stocks].sort(() => Math.random() - 0.5);
      const selectedStocks = shuffled.slice(0, quantity);

      for (const stock of selectedStocks) {
        await prisma.stock.update({
          where: { id: stock.id },
          data: { isSold: true }
        });
        deliveredContents.push(stock.content);
      }
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

    // 구매 영수증 생성 (개수만큼)
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

      const dmEmbed = new TextDisplayBuilder().setContent(dmContent);
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
        new TextDisplayBuilder().setContent(`✅ **구매가 완료되었습니다!**\n\n상품: ${product.name}\n수량: ${quantity}개\n결제: ${totalPrice.toLocaleString()}원\n\n📦 전달된 정보는 DM으로 발송되었습니다.`)
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
