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

/** 单次作答超过 6 秒记为慢词 */
export const MEMORY_SLOW_MS = 6000

export function clampStage(stage: number): number {
  return Math.min(MEMORY_LADDER.length - 1, Math.max(0, Math.round(Number(stage) || 0)))
}

export function ladderDays(stage: number): number {
  return MEMORY_LADDER[clampStage(stage)]
}

export function ladderText(stage: number): string {
  return MEMORY_LADDER_TEXT[clampStage(stage)]
}

export function nextStage(prevStage: number | undefined): number {
  return prevStage === undefined ? MEMORY_GRADUATE_STAGE : clampStage(prevStage + 1)
}
