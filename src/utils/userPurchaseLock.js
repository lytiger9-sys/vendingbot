const activeUserPurchases = new Set();

export function tryAcquireUserPurchaseLock(userId) {
  const key = String(userId);
  if (activeUserPurchases.has(key)) {
    return false;
  }

  activeUserPurchases.add(key);
  return true;
}

export function releaseUserPurchaseLock(userId) {
  if (userId === undefined || userId === null) {
    return;
  }

  activeUserPurchases.delete(String(userId));
}
