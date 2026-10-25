import type { Word } from '@/typings'

/**
 * 会话内错词重现队列（v8）：
 * 答错的词在本次练习中隔 3 个词强制再出现一次，同一个词最多再排 2 次。
 * 队列只存在内存里，退出应用即清空；持久化仍由 memoryRecords 的 10 分钟档负责。
 */
const REQUEUE_GAP = 3
const REQUEUE_MAX_TIMES = 2

type RequeueEntry = {
  key: string
  word: Word
  dict: string
  /** 还要跳过几个词才出现 */
  skip: number
  /** 已排队次数 */
  times: number
}

let queue: RequeueEntry[] = []

function normalize(name: string): string {
  return String(name || '')
    .trim()
    .toLowerCase()
}

/** 答错后登记：稍后（隔 3 个词）在本次会话内再练一次。 */
export function pushWrongWordRequeue(dict: string, word: string, trans?: string[], phone?: string): void {
  const name = String(word || '').trim()
  if (!dict || !name) return
  const key = `${dict}::${normalize(name)}`
  const existing = queue.find((item) => item.key === key)
  if (existing) {
    if (existing.times >= REQUEUE_MAX_TIMES) return
    existing.skip = REQUEUE_GAP
    existing.times += 1
    return
  }
  queue.push({
    key,
    dict,
    skip: REQUEUE_GAP,
    times: 1,
    word: {
      name,
      trans: Array.isArray(trans) ? trans.filter((item) => typeof item === 'string') : [],
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

export function clearSessionRequeue(): void {
  queue = []
}
