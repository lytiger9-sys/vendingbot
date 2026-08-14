const AUTO_CHARGE_WINDOW_MS = 5 * 60 * 1000;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMatchText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function extractDepositAmount(content) {
  const text = String(content ?? '');
  const amountMatch = text.match(/(\d[\d,]*)\s*원/);

  if (!amountMatch) {
    return null;
  }

  const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
  return Number.isNaN(amount) ? null : amount;
}

export function matchesSenderName(content, senderName) {
  const normalizedSenderName = normalizeMatchText(senderName);
  if (!normalizedSenderName) {
    return false;
  }

  const normalizedContent = normalizeMatchText(content);
  if (normalizedContent.includes(normalizedSenderName)) {
    return true;
  }

  if (normalizedSenderName.length < 2) {
    return false;
  }

  const first = normalizedSenderName[0];
  const last = normalizedSenderName[normalizedSenderName.length - 1];
  const maskPattern = new RegExp(
    `${escapeRegex(first)}(?:[\\s*?oOxX·•#._-]|[\\p{P}\\p{S}]){1,12}${escapeRegex(last)}`,
    'u'
  );

  return maskPattern.test(normalizedContent);
}

export function getAutoChargeWindowCutoff(now = new Date()) {
  return new Date(now.getTime() - AUTO_CHARGE_WINDOW_MS);
}

export function isWithinAutoChargeWindow(createdAt, now = new Date()) {
  return new Date(createdAt).getTime() >= getAutoChargeWindowCutoff(now).getTime();
}
