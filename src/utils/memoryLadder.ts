/**
 * 艾宾浩斯记忆曲线阶梯（单位：天）
 * 10 分钟 → 30 分钟 → 12 小时 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天 → 60 天 → 120 天 → 240 天
 */
export const MEMORY_LADDER = [10 / 1440, 30 / 1440, 0.5, 1, 2, 4, 7, 15, 30, 60, 120, 240] as const

export const MEMORY_LADDER_TEXT = [
  '10 分钟',
  '30 分钟',
  '12 小时',
  '1 天',
  '2 天',
  '4 天',
  '7 天',
  '15 天',
  '30 天',
  '60 天',
  '120 天',
  '240 天',
] as const

/** 新词首次答对后进入 1 天档 */
export const MEMORY_GRADUATE_STAGE = 3

/**
 * 单次作答超过 6 秒记为慢词。
 * v9.3.1（SRS-007）：收敛为单一来源 —— 以 `srsRules.MEMORY_SLOW_MS` 为准，这里只做 re-export。
 * （此前 memoryLadder 与 srsRules 各定义一份 6000，实际生效的是 srsRules 那份，改一处会出现口径分叉。）
 */
export { MEMORY_SLOW_MS } from './srsRules'

export function clampStage(stage: number): number {
  return Math.min(MEMORY_LADDER.length - 1, Math.max(0, Math.round(Number(stage) || 0)))
}

export function ladderDays(stage: number): number {
  return MEMORY_LADDER[clampStage(stage)]
}

export function ladderText(stage: number): string {
  return MEMORY_LADDER_TEXT[clampStage(stage)]
}

/**
 * 下一档（新词 undefined → 3 档）。
 * @deprecated v9.3.1（SRS-007）：src 内已无调用点（db 用的是 `clampStage(stage + 1)` + `MEMORY_GRADUATE_STAGE`）。
 * 保留导出只为不破坏 `D:\整理\audit\_v93-entry.ts` 的 re-export（删除会让门禁 bundle 构建失败）；
 * 等审计入口同步移除后再删除本函数。
 */
export function nextStage(prevStage: number | undefined): number {
  return prevStage === undefined ? MEMORY_GRADUATE_STAGE : clampStage(prevStage + 1)
}

export type AdaptiveInput = {
  stage: number
  ease?: number
  correct?: number
  wrong?: number
  slow?: number
  attempts?: number
}

/**
 * v8.3 影子调度：按「当前档位 + 熟练度(ease) + 历史正确率 + 慢词比例」估算自适应间隔（天）。
 * 只写入 memoryRecords 的 shadow* 字段用于对比，不改变现有固定阶梯的到期时间；
 * 积累足够样本后再决定是否切换。
 */
export function adaptiveDaysFromRecord(rec: AdaptiveInput): number {
  const base = ladderDays(rec.stage)
  const attempts = Math.max(0, Number(rec.attempts) || (Number(rec.correct) || 0) + (Number(rec.wrong) || 0))
  const correct = Math.max(0, Number(rec.correct) || 0)
  const accuracy = attempts > 0 ? Math.min(1, correct / attempts) : 0.8
  const ease = Math.min(3.2, Math.max(1.2, Number(rec.ease) || 2.5))
  let factor = 0.55 + 0.55 * accuracy
  factor *= ease / 2.5
  const slowRatio = attempts > 0 ? (Number(rec.slow) || 0) / attempts : 0
  if (slowRatio > 0.3) factor *= 0.85
  const days = base * factor
  const min = MEMORY_LADDER[0]
  const max = MEMORY_LADDER[MEMORY_LADDER.length - 1]
  return Math.min(max, Math.max(min, Math.round(days * 1440) / 1440))
}
