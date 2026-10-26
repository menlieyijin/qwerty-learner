/**
 * 记忆记录 key 的统一实现。
 *
 * v8.9：之前 memory.ts / db/index.ts / sessionRequeue.ts 各自写了一份「trim + 小写」，
 * 存在不一致风险（memory.ts trim、db/index.ts 不 trim），统一收敛到 memoryKey。
 *
 * v9.5（数据修复 DATA-003）：把「比较口径」与「主键口径」拆开——
 * - `normalizeWordName`：**比较口径**（trim + 小写）。用于「跨词库同名去重 / 词库释义查找 /
 *   autoLevel 的 seen 集合」等需要忽略大小写的场景，语义保持不变；
 * - `normalizeWordKeyWord`：**SRS 主键口径**（首尾 trim + 内部连续空白收敛为单空格，**保留大小写**）。
 *   记忆曲线记录按它做 key：`March`(三月) 与 `march`(行军) 是两个不同词条，必须各自独立记录；
 * - `legacyMemoryKey`：v9.4 及之前的 key（trim + 小写），仅用于兼容读取/删除既有记录，
 *   由 memory.ts 的 `memoryKeyCaseV2` 一次性迁移把数据复制到新 key（不删除旧记录）。
 */
export function normalizeWordName(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
}

/** v9.5：SRS key 专用归一化——收敛空白但保留大小写（不改变"哪个词"） */
export function normalizeWordKeyWord(name: string): string {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** v9.5：记忆曲线记录 key（大小写敏感） */
export function memoryKey(dict: string, word: string): string {
  return `${dict}::${normalizeWordKeyWord(word)}`
}

/** v9.5：v9.4 及之前的 key（trim + lower），仅用于兼容旧记录 */
export function legacyMemoryKey(dict: string, word: string): string {
  return `${dict}::${normalizeWordName(word)}`
}

/** 读取/删除某个词时需要考虑的候选 key：新 key 优先，legacy key 次之（相同则只返回一个） */
export function memoryKeyCandidates(dict: string, word: string): string[] {
  const next = memoryKey(dict, word)
  const legacy = legacyMemoryKey(dict, word)
  return next === legacy ? [next] : [next, legacy]
}
