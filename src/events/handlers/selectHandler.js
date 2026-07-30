import { StringSelectMenuBuilder, ActionRowBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ButtonBuilder, ButtonStyle } from 'discord.js';

export async function handleSelectMenu(interaction, client, prisma) {
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

    // 재고형인 경우
    if (!product.isFixed && availableStock === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(0xFF5555)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## ${product.name}\n\n${product.description || '설명 없음'}\n\n**가격:** ${product.price.toLocaleString()}원\n**남은 재고:** 0개\n\n❌ **재고가 없습니다.**`
          )
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
          new TextDisplayBuilder().setContent(
            `## ${product.name}\n\n${product.description || '설명 없음'}\n\n**가격:** ${product.price.toLocaleString()}원\n**종류:** 고정형\n\n정말 구매하시겠습니까?`
          )
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