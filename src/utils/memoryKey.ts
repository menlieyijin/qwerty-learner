/**
 * v8.9：记忆记录 key 的统一实现。
 * 之前 memory.ts / db/index.ts / sessionRequeue.ts 各自写了一份「trim + 小写」，
 * 存在不一致风险（memory.ts trim、db/index.ts 不 trim），统一收敛到这里。
 */
export function normalizeWordName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
}

export function memoryKey(dict: string, word: string): string {
  return `${dict}::${normalizeWordName(word)}`
}
