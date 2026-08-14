export function clampDiscountRate(value) {
  const rate = Number.parseInt(value, 10);
  if (Number.isNaN(rate)) {
    return 0;
  }

  return Math.min(100, Math.max(0, rate));
}

export function getHighestDiscountRate(records = []) {
  return records.reduce((highest, record) => {
    return Math.max(highest, clampDiscountRate(record?.discountRate));
  }, 0);
}

export function calculateDiscountedAmount(baseAmount, productDiscountRate = 0, roleDiscountRate = 0) {
  const normalizedBaseAmount = Math.max(0, Math.trunc(Number(baseAmount) || 0));
  const normalizedProductDiscountRate = clampDiscountRate(productDiscountRate);
  const normalizedRoleDiscountRate = clampDiscountRate(roleDiscountRate);

  const afterProductDiscountAmount = Math.floor(
    normalizedBaseAmount * (100 - normalizedProductDiscountRate) / 100
  );
  const finalAmount = Math.floor(
    afterProductDiscountAmount * (100 - normalizedRoleDiscountRate) / 100
  );

  return {
    originalAmount: normalizedBaseAmount,
    productDiscountRate: normalizedProductDiscountRate,
    roleDiscountRate: normalizedRoleDiscountRate,
    productDiscountAmount: normalizedBaseAmount - afterProductDiscountAmount,
    roleDiscountAmount: afterProductDiscountAmount - finalAmount,
    discountAmount: normalizedBaseAmount - finalAmount,
    finalAmount,
  };
}

export function splitAmountAcrossQuantity(totalAmount, quantity) {
  const normalizedTotalAmount = Math.max(0, Math.trunc(Number(totalAmount) || 0));
  const normalizedQuantity = Math.max(1, Math.trunc(Number(quantity) || 0));
  const baseShare = Math.floor(normalizedTotalAmount / normalizedQuantity);
  let remainder = normalizedTotalAmount - baseShare * normalizedQuantity;

  return Array.from({ length: normalizedQuantity }, () => {
    const share = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return share;
  });
}
