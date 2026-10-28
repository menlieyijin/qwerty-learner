/**
 * v9.3 SRS / 艾宾浩斯记忆曲线**纯规则**模块。
 *
 * 设计目标：
 * - 只放与 React / DOM / IndexedDB 无关的纯函数，便于被 `db/index.ts`、`autoLevel.ts` 与仿真脚本共用；
 * - 把「到期日粒度、答错降档、lapse / slow 口径、时钟回拨、迁移码值」等规则从 DB 层剥离，
 *   避免 v9.2 里这些规则散落在 `updateMemoryProgress` 分支中难以回归测试；
 * - 默认所有时间戳均为毫秒 epoch，`computeDue` 的“日”按**本地自然日**计算（见函数注释）。
 *
 * 依据：v9.3 SRS / 记忆曲线修复设计（见 docs/DSH-FORK.md）第二章。
 */

/** 成熟档：`stage >= MEMORY_MATURE_STAGE`（1 天档及以上）视为“已学会”。只有成熟词答错才计 lapse / 走分级降档。 */
export const MEMORY_MATURE_STAGE = 3

/**
 * 成熟词答错的分级阈值：
 * - 本次作答错误次数 `< MEMORY_MAX_WRONG_DEMOTE`（即 1 次手滑）→ 只降 2 档，保留大部分已建立的记忆；
 * - `>= MEMORY_MAX_WRONG_DEMOTE`（≥2 次，确实不会）→ 回 0 档（10 分钟）重新学。
 */
export const MEMORY_MAX_WRONG_DEMOTE = 2

/** 单次作答超过 6 秒记为慢词。与 `memoryLadder.MEMORY_SLOW_MS` 数值保持一致（此处为 srsRules 的自有常量）。 */
export const MEMORY_SLOW_MS = 6000

/** 掌握判定：至少答对 2 次（新词首答对不算掌握）。 */
const MASTERED_MIN_CORRECT = 2
/** 掌握判定：至少 2 档（12 小时档及以上），避免“刚见过”就算掌握。 */
const MASTERED_MIN_STAGE = 2

const MS_PER_DAY = 24 * 3600 * 1000

/** `evaluateWrong` 的输入记录（只读取需要的字段，便于测试与旧记录兼容）。 */
export type WrongEvalInput = {
  stage: number
  ease: number
  lapses: number
} | null | undefined

/** `evaluateWrong` 的返回值：新档位、新 ease、本次 lapse 增量、是否计入 lapse。 */
export type WrongEvalResult = {
  stage: number
  ease: number
  lapseDelta: number
  countLapse: boolean
}

/** `isMastered` 的输入记录（只读取需要的字段）。 */
export type MasteryRecord = {
  correct: number
  stage: number
  lastResult?: string
} | null | undefined

/**
 * 计算下次到期时间。
 *
 * - `intervalDays >= 1`：按**本地自然日**到期，返回「目标日 00:00」的本地时间戳。
 *   目标日 = 今天 + `Math.round(intervalDays)` 天。这样 23:00 学的 1 天档词会在**次日 00:00**
 *   就进入到期池（次日一开始就能复习），而不是等到次日 23:00（v9.2 的 P1-6 问题）。
 * - `intervalDays < 1`（10 分钟 / 30 分钟 / 12 小时档）：保持精确毫秒 `now + intervalDays * 24h`。
 * - 非法输入（NaN / 非正数）返回 `now` 本身，保证调用方不会写入 NaN due。
 *
 * @param now 当前时间（毫秒 epoch）
 * @param intervalDays 间隔（天），来自 `MEMORY_LADDER`
 */
export function computeDue(now: number, intervalDays: number): number {
  const base = Number(now)
  if (!Number.isFinite(base)) return 0
  const days = Number(intervalDays)
  if (!Number.isFinite(days) || days <= 0) return base
  if (days < 1) return base + Math.round(days * MS_PER_DAY)
  const target = new Date(base)
  target.setDate(target.getDate() + Math.max(1, Math.round(days)))
  target.setHours(0, 0, 0, 0)
  return target.getTime()
}

/**
 * 根据一次**答错**计算新的 stage / ease / lapse 增量。
 *
 * 规则（v9.3 分级降档，替代 v9.2「任何错都回 0 档」）：
 * - 新词（`prev` 为 null/undefined）或 `prev.stage < MEMORY_MATURE_STAGE`：`stage = 0`（回 10 分钟档）；
 * - 成熟词且本次错误次数 `< MEMORY_MAX_WRONG_DEMOTE`（1 次）：`stage = max(1, prev.stage - 2)`；
 * - 成熟词且本次错误次数 `>= MEMORY_MAX_WRONG_DEMOTE`（≥2 次）：`stage = 0`；
 * - 所有答错：`ease = max(1.3, prev.ease - 0.2)`（保留 2 位小数；无历史记录时以 2.5 为基准）；
 * - `countLapse` / `lapseDelta`：仅「已有记录且 `prev.stage >= MEMORY_MATURE_STAGE`」记 1 次 lapse，
 *   新词首错只 `wrong + 1`，不污染 lapse 口径（v9.2 的 P2-9）。
 *
 * 说明：`wrongCount` 会被归一化为 `>= 1` 的整数（个别调用方传 0 时按“单次错误”处理），
 * 因此本函数只应在确实答错的分支里调用。
 *
 * @param prev 上一次的记忆记录（新词传 null/undefined）
 * @param wrongCount 本次作答的错误次数（写库时的 `wordState.wrongCount`）
 */
export function evaluateWrong(prev: WrongEvalInput, wrongCount: number): WrongEvalResult {
  const prevStage = Math.max(0, Math.floor(Number(prev?.stage) || 0))
  const rawEase = Number(prev?.ease)
  const prevEase = Number.isFinite(rawEase) && rawEase > 0 ? rawEase : 2.5
  const errors = Math.max(1, Math.floor(Number(wrongCount) || 0))
  const mature = !!prev && prevStage >= MEMORY_MATURE_STAGE
  const countLapse = mature
  const demote = mature && errors < MEMORY_MAX_WRONG_DEMOTE
  const stage = demote ? Math.max(1, prevStage - 2) : 0
  const ease = Math.max(1.3, Math.round((prevEase - 0.2) * 100) / 100)
  return { stage, ease, lapseDelta: countLapse ? 1 : 0, countLapse }
}

/**
 * 是否记为慢词：作答总时长严格大于 `MEMORY_SLOW_MS`（6000ms 整不算慢）。
 * 该统计与「答对/答错/回顾」分支无关，调用方应在分支前统一调用（v9.2 的 P2-9）。
 *
 * @param totalMs 本次作答的总毫秒数
 */
export function shouldCountSlow(totalMs: number): boolean {
  const ms = Number(totalMs)
  return Number.isFinite(ms) && ms > MEMORY_SLOW_MS
}

/**
 * 掌握度判定（自动进阶升级门槛使用）：
 * `correct >= 2 && stage >= 2 && lastResult !== 'wrong'`。
 *
 * - 新词首答对（correct=1）不算掌握；
 * - `lastResult === 'wrong'`（最近一次答错，处于降档复习中）不算掌握；
 * - 无 `lastResult` 的历史/迁移记录按“最近无错”处理（只校验 correct/stage）。
 *
 * @param rec 记忆记录（可为空）
 */
export function isMastered(rec: MasteryRecord): boolean {
  if (!rec) return false
  const correct = Math.max(0, Number(rec.correct) || 0)
  const stage = Math.max(0, Number(rec.stage) || 0)
  return correct >= MASTERED_MIN_CORRECT && stage >= MASTERED_MIN_STAGE && rec.lastResult !== 'wrong'
}

/**
 * 是否已到期：`due > 0 && now >= due`。
 * `due <= 0` 视为“尚未排程”，不算到期（避免把损坏/中间态记录计入到期池）。
 *
 * @param now 当前时间（毫秒 epoch）
 * @param due 到期时间（毫秒 epoch）
 */
export function isDue(now: number, due: number): boolean {
  const n = Number(now)
  const d = Number(due)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return false
  return n >= d
}

/**
 * 时钟回拨校正（v9.3.1 / SRS-002）：若 `now < lastSeen`（用户改系统时间 / CMOS 掉电 /
 * 跨设备导入时钟超前的数据），说明 `due` 可能落在“未来很久”，会导致该词长期进不了到期池、
 * 复习只退化为随机回顾（v9.2 的 P1-4 只修了答题路径，取词路径一直没修）。
 *
 * 保守策略（只处理“能确定是时钟错”的记录）：
 * - `now >= lastSeen`（正常记录）：**原样返回 `due`**，绝不影响 15/30/60/120/240 天等正常长间隔；
 * - `now < lastSeen`（记录时间戳在未来）：把 `due` 压回 `min(due, now + intervalDays 天)`，
 *   即“至少不会比它自己的间隔更远”；
 * - `intervalDays` 缺省为 0 时退化为 `min(due, now)`（等价“立即可复习”的历史语义）；
 * - 非法 `now`：返回合法 `due`；非法 `due`：返回 `now`（调用方不会写入 NaN）。
 *
 * @param now 当前时间（毫秒 epoch）
 * @param lastSeen 上次作答时间（毫秒 epoch）
 * @param due 原到期时间（毫秒 epoch）
 * @param intervalDays 该记录当前间隔（天，来自 `MEMORY_LADDER`），用于把未来 due 压回一个正常间隔内
 * @returns 校正后的到期时间（未触发校正时与入参 `due` 完全相等）
 */
export function correctClockRollback(now: number, lastSeen: number, due: number, intervalDays = 0): number {
  const n = Number(now)
  const l = Number(lastSeen)
  const d = Number(due)
  if (!Number.isFinite(n)) return Number.isFinite(d) ? d : 0
  const safeDue = Number.isFinite(d) ? d : n
  // 非回拨（正常记录）：保持原值，避免误伤正常长间隔
  if (!Number.isFinite(l) || n >= l) return safeDue
  const days = Number(intervalDays)
  const span = Number.isFinite(days) && days > 0 ? Math.round(days * MS_PER_DAY) : 0
  return Math.min(safeDue, n + Math.max(0, span))
}

/**
 * 单条记忆记录在当前时刻的“有效到期时间”（v9.3.1 / SRS-002）。
 * 取词池、到期计数、复习债展示都应使用这个口径，保证「显示的数字」与「实际能抽到的词」一致。
 *
 * @param now 当前时间（毫秒 epoch）
 * @param record 需要 `due` / `lastSeen` / `interval` 的最小记录形状
 */
export function effectiveDueOf(
  now: number,
  record: { due?: number | null; lastSeen?: number | null; interval?: number | null } | null | undefined,
): number {
  if (!record) return 0
  return correctClockRollback(now, Number(record.lastSeen) || 0, Number(record.due) || 0, Number(record.interval) || 0)
}

/**
 * 旧 `wordRecords` → `memoryRecords` 迁移时的 stage 映射（保持 v9.2 语义不变）：
 * - 历史总错误数 0 → 3 档（1 天，等同 `MEMORY_GRADUATE_STAGE`）；
 * - 1~2 次 → 2 档（12 小时）；
 * - ≥3 次 → 1 档（30 分钟）。
 *
 * @param wrong 该词历史累计错误次数
 */
export function migrateStage(wrong: number): number {
  const w = Math.max(0, Math.floor(Number(wrong) || 0))
  if (w === 0) return 3
  if (w <= 2) return 2
  return 1
}
