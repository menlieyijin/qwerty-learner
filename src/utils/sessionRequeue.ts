import { memoryKey } from './memoryKey'
import { normalizeTrans } from '@/utils/trans'
import type { Word } from '@/typings'

/**
 * 会话内错词重现队列（v8）：
 * 答错的词在本次练习中隔 3 个词强制再出现，同一个词最多再排 2 次。
 * 队列只存在内存里，退出应用即清空；持久化仍由 memoryRecords 的 10 分钟档负责。
 *
 * v8.9：
 * - 用 sessionCounts 记「本会话累计重排次数」；之前取出即删、再错重建 times=1，上限实际失效；
 * - 换词库/换模式/新会话时调用 clearSessionRequeue()，避免 A 词库的错词串进 B 词库。
 */
const REQUEUE_GAP = 3
const REQUEUE_MAX_TIMES = 2

type RequeueEntry = {
  key: string
  word: Word
  dict: string
  /** 还要跳过几个词才出现 */
  skip: number
}

let queue: RequeueEntry[] = []
const sessionCounts = new Map<string, number>()

/** 答错后登记：稍后（隔 3 个词）在本次会话内再练一次。 */
export function pushWrongWordRequeue(dict: string, word: string, trans?: string[], phone?: string): void {
  const name = String(word || '').trim()
  if (!dict || !name) return
  const key = memoryKey(dict, name)
  const used = sessionCounts.get(key) || 0
  if (used >= REQUEUE_MAX_TIMES) return
  sessionCounts.set(key, used + 1)
  const existing = queue.find((item) => item.key === key)
  if (existing) {
    existing.skip = REQUEUE_GAP
    return
  }
  queue.push({
    key,
    dict,
    skip: REQUEUE_GAP,
    word: {
      name,
      trans: normalizeTrans(trans),
      usphone: phone || '',
      ukphone: phone || '',
      dict,
    },
  })
}

/** 每次取词前调用：有到期的错词则取出（取出后从队列移除）；否则推进计数。 */
export function takeRequeueWord(): { word: Word; dict: string } | null {
  if (!queue.length) return null
  const ready = queue.filter((item) => item.skip <= 0)
  if (ready.length) {
    const picked = ready[Math.floor(Math.random() * ready.length)]
    queue = queue.filter((item) => item.key !== picked.key)
    return { word: picked.word, dict: picked.dict }
  }
  // 先检查再递减：skip=3 表示「中间先练 3 个其他词，第 4 个词重回」
  for (const item of queue) item.skip -= 1
  return null
}

/** 仅供调试/测试：当前队列长度。 */
export function getSessionRequeueCount(): number {
  return queue.length
}

/** 删除某词时把它从会话重练队列中移除（避免删完 30 分钟内又被拉回） */
export function removeFromRequeue(dict: string, word: string): void {
  const key = memoryKey(dict, word)
  queue = queue.filter((item) => item.key !== key)
  sessionCounts.delete(key)
}

/** 清空队列与计数（换词库/换模式/新会话时调用）。 */
export function clearSessionRequeue(): void {
  queue = []
  sessionCounts.clear()
}
