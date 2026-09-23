export class PromiseTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'PromiseTimeoutError';
  }
}

export async function withTimeout(promise, timeoutMs, operation) {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new PromiseTimeoutError(operation, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
