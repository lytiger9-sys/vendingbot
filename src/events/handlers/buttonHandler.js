import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { processPurchase } from './purchaseProcessor.js';
import { getDashboardUrl } from '../../utils/runtimeConfig.js';

export async function handleButton(interaction, client, prisma) {
  const { customId } = interaction;

  // SERVER_ID 검증 헬퍼 함수 (async/await 적용)
  const checkServerId = async (interaction) => {
    const serverId = process.env.SERVER_ID;
    if (serverId && interaction.guildId !== serverId) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '이 서버에서는 사용할 수 없습니다.',
          ephemeral: true
        });
      }
      return false;
    }
    return true;
  };

  // 입금 버튼
  if (customId === 'btn_deposit') {
    if (!(await checkServerId(interaction))) return;
    
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
    if (!(await checkServerId(interaction))) return;
    
    const categories = await prisma.category.findMany({
      orderBy: { id: 'asc' },
      include: { products: true }
    });

    if (categories.length === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **등록된 카테고리가 없습니다.**')
        );

      return await interaction.reply({
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
    if (!(await checkServerId(interaction))) return;
    
    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
    const balance = (user?.balance || 0).toLocaleString();
    const totalSpent = (user?.totalSpent || 0).toLocaleString();

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const userRoleIds = member?.roles.cache.map(r => r.id) || [];

    const roleRewards = await prisma.roleReward.findMany();
    const userRewards = roleRewards.filter(r => userRoleIds.includes(r.roleId));
    const maxRoleDiscountRate = userRewards.reduce(
      (max, reward) => Math.max(max, Number(reward.discountRate) || 0),
      0
    );

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
          `보유 역할 할인: ${maxRoleDiscountRate > 0 ? `${maxRoleDiscountRate}%` : '없음'}\n` +
          `할인 우선순위: 상품 할인 우선\n` +
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
    const dashboardUrl = getDashboardUrl();

    const container = new ContainerBuilder()
      .setAccentColor(0x00FF00)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## ⭐ 후기 작성\n어디에서 후기를 작성하시겠어요?')
      )
      .addActionRowComponents(
        new ActionRowBuilder({
          components: [
            new ButtonBuilder({
              customId: 'btn_review_discord',
              label: '💬 디스코드에서 하기',
              style: ButtonStyle.Primary
            }),
            new ButtonBuilder({
              label: '🌐 웹에서 하기',
              style: ButtonStyle.Link,
              url: `${dashboardUrl}/dashboard/review`
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

  // 후기 - 디스코드에서 작성하기 선택
  if (customId === 'btn_review_discord') {
    const unreviewedReceipts = await prisma.receipt.findMany({
      where: { userId: interaction.user.id, hasReview: false },
      include: { product: true },
      orderBy: { purchasedAt: 'desc' },
      take: 25
    });

    if (unreviewedReceipts.length === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('❌ **후기를 작성할 수 있는 구매 내역이 없습니다.**')
        );

      return await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        ephemeral: true
      });
    }

    const options = unreviewedReceipts.map(r => ({
      label: `${r.product?.name || '알 수 없는 상품'} - ${r.paidAmount.toLocaleString()}원`,
      value: r.id,
      description: new Date(r.purchasedAt).toLocaleDateString('ko-KR')
    }));

    const selectMenu = new ActionRowBuilder({
      components: [
        new StringSelectMenuBuilder({
          customId: 'select_review_target',
          placeholder: '후기를 작성할 구매 내역을 선택하세요',
          options
        })
      ]
    });

    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('📝 후기를 작성할 구매 내역을 선택해주세요.')
      )
      .addActionRowComponents(selectMenu);

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
    return;
  }

  // 홈페이지 버튼
  if (customId === 'btn_website') {
    const dashboardUrl = getDashboardUrl();

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
              url: dashboardUrl
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
    const productId = customId.split('_')[2];
    const lockKey = `${interaction.user.id}_${productId}`;
    
    if (global.purchaseLock && global.purchaseLock.has(lockKey)) {
      if (!interaction.replied && !interaction.deferred) {
        return await interaction.reply({
          content: '⏳ 이미 구매가 진행 중입니다. 잠시만 기다려주세요.',
          ephemeral: true
        });
      }
      return;
    }
    
    if (!global.purchaseLock) global.purchaseLock = new Map();
    global.purchaseLock.set(lockKey, true);
    setTimeout(() => global.purchaseLock.delete(lockKey), 5000);
    
    await processPurchase(interaction, productId, prisma, client, 1, lockKey);
    return;
  }

  // 구매 취소 버튼
  if (customId === 'purchase_cancel') {
    const container = new ContainerBuilder()
      .setAccentColor(0x666666)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('❌ **구매가 취소되었습니다.**')
      );

    return await interaction.update({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      ephemeral: true
    });
  }
}