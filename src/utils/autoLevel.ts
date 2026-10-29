/**
 * v9.3 自动进阶状态模块（纯状态/进度/升级判定，不改 memory.ts / UI）
 *
 * 设计依据：v9.3 自动进阶修复设计（见 docs/DSH-FORK.md）一、三章。
 * 目标（修复 v9.2 审计 P0）：
 * 1. 级别持久化在 localStorage `qzAutoLevelState`，不再每次从第 0 级反推 → 删除记录不回退；
 * 2. 升级判据从「见过」改为「已见 100% 且掌握 ≥85%」（掌握 = srsRules.isMastered；v9.11 起 85%，原 90%）；
 * 3. Skip 累计 3 次 → suspended，不阻塞升级、进「待攻克」；
 * 4. 记录按 word 取最优（跨级/跨词库同词去重），不按 memoryKey 的 dict 限定；
 * 5. 词库加载失败（抛错或空级别）标记 error，不判完成。
 *
 * 约束：不 import db/index.ts、不 import React；仅依赖 learningPath / memoryKey / memoryCache / srsRules / 类型。
 * （v9.3.1：`resumeWord` 里复位 lapses 需要写 indexDB，用**动态** `await import('@/utils/db')` 完成，
 *   与 db/index.ts 反向动态 import autoLevel 对称，不在模块初始化期形成 TDZ 循环。）
 */
import { effectiveDueOf, isDue, isMastered } from './srsRules'
import type { Word } from '@/typings'
import type { IMemoryRecord } from '@/utils/db/record'
import { LEARNING_PATH, loadLevelWords } from '@/utils/learningPath'
import type { LearningLevel } from '@/utils/learningPath'
import { clearMemoryCache } from '@/utils/memoryCache'
import { memoryKey, normalizeWordName } from '@/utils/memoryKey'

/** localStorage 键（随备份/导入迁移，见 enhance.js collectBackupSnapshot 的 localStorage 全量快照） */
export const AUTO_LEVEL_STORAGE_KEY = 'qzAutoLevelState'
/** 状态 schema 版本；升级数据结构时 +1，由 normalizeState 兜底迁移 */
export const AUTO_LEVEL_STATE_VERSION = 1
/** Skip 达到该次数后挂起该词（不阻塞本级升级，进「待攻克」） */
export const AUTO_LEVEL_SUSPEND_THRESHOLD = 3
/** 升级事件名；detail: LevelUpDetail */
export const AUTO_LEVEL_UP_EVENT = 'qz-auto-level-up'
/**
 * v9.3.1（SRS-006）：状态持久化失败事件名；detail: { message: string; at: number }
 * localStorage 不可用 / 写满时 saveAutoLevelState 返回 false，除 console.warn 外再派发该事件，
 * 便于数据页「自动进阶」卡片提示「状态未持久化」，不再静默丢档。
 */
export const AUTO_LEVEL_STATE_ERROR_EVENT = 'qz-auto-level-state-error'

/** 供顶栏/数据页快速展示的缓存信息（computeLevelProgress / getCachedInfo 写入） */
export type AutoLevelCachedInfo = {
  name: string
  total: number
  /** 已见（required 中已存在任一最优记录） */
  seen: number
  /** 已掌握（srsRules.isMastered 为真） */
  mastered: number
  suspendedCount: number
  /** 当前到期词数（按 word 去重） */
  due: number
  /** 建议新词比例（0~1，由 due 分档计算，供 memory.ts 出词使用） */
  newRatio: number
  updatedAt: number
}

export type AutoLevelState = {
  version: typeof AUTO_LEVEL_STATE_VERSION
  /** 当前级别 id（持久化；只升不回退） */
  levelId: string
  startedAt: number
  /** memoryKey(dict, word) = `${dict}::${保留大小写的 word}`（v9.5 起大小写敏感，见 memoryKey.ts） -> 累计 Skip 次数（全局） */
  skipped: Record<string, number>
  /** 达阈值或手动挂起的 memoryKey 列表 */
  suspended: string[]
  /**
   * v9.3.1（SRS-005）：本模块最后一次写入时已知的 suspended 集合快照。
   * 用于识别「外部直接改 localStorage 把 suspended 清空」的恢复动作（增强面板「恢复全部待攻克」
   * 走的是 enhance.js 直接 setItem + location.reload()，不会调用 resumeWord）。
   * 启动时 `suspendedSnapshot - suspended` = 被外部恢复的词 → 补做 lapses 复位。
   */
  suspendedSnapshot?: string[]
  /** 最近一次升级时间 */
  lastLevelUpAt?: number
  cached?: AutoLevelCachedInfo
}

/** 单个级别的进度快照（computeLevelProgress 返回） */
export type LevelProgress = {
  levelId: string
  /** LEARNING_PATH 下标，0-based */
  index: number
  name: string
  /** 本级词表总量（含已挂起词） */
  total: number
  /** 需要完成的词数 = total - suspended（已挂起词不阻塞升级） */
  required: number
  /** required 中已见词数 */
  seen: number
  /** required 中已掌握词数（srsRules.isMastered） */
  mastered: number
  /** 本级中处于挂起状态的词数 */
  suspended: number
  /** required 中未见到过的词数 = newWords.length */
  unseen: number
  /** 本级未学词（newWords，已排除 suspended；dict 沿用词库加载结果） */
  newWords: Word[]
  /** 完成：required === 0，或 seen === required 且 mastered / required >= MASTERY_RATIO（v9.11：0.85） */
  done: boolean
  /** 词库加载失败标记：此时不判完成，调用方应提示用户 */
  error?: 'load-failed'
}

export type SkipRecordResult = {
  count: number
  suspended: boolean
  /** v9.3.1（SRS-006）：本次状态是否成功落盘；false 表示 localStorage 不可用/写满（已 console.warn + 派发事件） */
  persisted: boolean
}

export type LevelUpDetail = {
  from: string
  to: string
  levelId: string
  name: string
  at: number
}

export type AdvanceResult = {
  progress: LevelProgress
  levelUps: LevelUpDetail[]
  state: AutoLevelState
}

/**
 * 毕业线：本级「已见 100%」前提下，掌握率达到此比例即升级（只升不回退）。
 *
 * v9.11：0.90 → 0.85。原因：用户实测「进阶难度太大了，一直在重复同一批」——只加混级
 * （v9.11 的 70% 起掺入）会把毕业推迟约 30 天（S1 38→68 天），0.85 把升级日拉回基线附近，
 * 且让「70% 起掺入 → 85% 毕业」成为一条连续进度轴（MIX_FULL 与 MASTERY_RATIO 对齐）。
 * 代价（明确接受）：最多 15% 未掌握词随升级带走——它们仍在记忆库里，会作为到期词
 * 继续复习（只是不再阻塞本级毕业）；「只升不回退」的语义不变，回退仍只能靠显式「重新评估」。
 */
const MASTERY_RATIO = 0.85

/**
 * v9.11「70% 掌握即掺入上级词」：
 * 本级掌握度到 MIX_START 后，每次取词有 getMixRatio() 的概率落到 **下一级** 的一个未学词
 * （只展示/记录，不改 levelId，不参与本级完成判定）；到 MIX_FULL 时比例封顶 MIX_MAX。
 * 语义：getMixRatio 返回的是「本次取词落到下一级的概率」，由 memory.pickDynamicWord 在
 * 本次没有出到本级新词时（到期词/回顾占了抽样，或本级新词已出完）按此概率掷骰
 * （会话内另有 MIX_WINDOW_CAP 窗口上限负责限流）。
 */
export const MIX_START = 0.7
/** 掺入比例封顶点：与毕业线 MASTERY_RATIO(0.85) 对齐，等价于「快毕业时先尝鲜下一级」 */
export const MIX_FULL = 0.85
export const MIX_MIN = 0.1
/**
 * 掺入概率上限 30%。
 *
 * 自洽约束（invariant）：**两套封顶必须恒等** —— `MIX_MAX === MIX_WINDOW_CAP / MIX_WINDOW_SIZE`
 * （0.30 === 6/20）。v9.11 曾出现「概率封顶 0.30 / 窗口封顶 4÷20=0.20」两套互相矛盾的封顶值，
 * 概率上限永远达不到，等于悄悄把掺入率砍到 20%；v9.11 把两者统一成一个数，改任何一个都必须同时改另一个
 * （门禁 B-19.capAligned 断言这一点）。
 *
 * 为什么是 30% 而不是 20%（实测，见 audit/mix70-sim.mjs 三联对照，2 场景 × 3 种子，200 次/天固定参数）：
 * - 0.30 + 6/20：升级日 S1 40.33（无混级基线 38.00，+6.1%）、S2 44.33（= 基线 44.33）；
 * - 0.20 + 4/20：升级日 S1 49.67（+30.8%）、S2 45.33。
 * 掺入不是「线性挤占」本级练习：它降低了本级词的复习密度，而 80~85% 正确率下复习越密集 lapse 越多，
 * 掌握率的**稳态**反而更低。所以封顶值要按实测选，不能按「掺入越少越快毕业」的直觉选。
 *
 * 注意窗口仍是硬约束（最近 20 次里已掺入 6 次后额度归零，要等旧掺入词滑出窗口才恢复），
 * 因此**实测**长期掺入率略低于名义值：84% 掌握时 22.8%（nominal 28.7%），见 audit B-20.longRunRate。
 */
export const MIX_MAX = 0.3
/** 小级别（required < 20）样本太少，掌握度抖动大，不掺入 */
export const MIX_MIN_REQUIRED = 20
/** 会话滑动窗口：最近 20 次取词里最多 6 次是下一级掺入词（6/20 = 30%，与 MIX_MAX 恒等） */
export const MIX_WINDOW_CAP = 6
export const MIX_WINDOW_SIZE = 20

/**
 * 掺入比例（0 表示不掺入）：required 为 0/过小 → 0；m<70% → 0；m>=85% → 0.30；
 * 中间线性插值 0.10 → 0.30（m=75% → 0.1667、m=80% → 0.2333、m=84% → 0.2867）。
 * 曲线与「70% 起、85% 毕业」的进度轴对齐。纯函数，不读状态不掷骰，便于断言。
 */
export function getMixRatio(mastered: number, required: number): number {
  const req = sanitizeNonNegativeInt(required)
  if (!req || req < MIX_MIN_REQUIRED) return 0
  const m = sanitizeNonNegativeInt(mastered) / req
  if (m < MIX_START) return 0
  if (m >= MIX_FULL) return MIX_MAX
  return MIX_MIN + (MIX_MAX - MIX_MIN) * ((m - MIX_START) / (MIX_FULL - MIX_START))
}

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

function getStorage(): Storage | null {
  try {
    const globalObject = typeof globalThis !== 'undefined' ? (globalThis as { localStorage?: Storage }) : undefined
    return globalObject && globalObject.localStorage ? globalObject.localStorage : null
  } catch {
    return null
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value)
}

function sanitizeNonNegativeInt(value: unknown): number {
  const n = Number(value)
  return isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function findLevelIndex(levelId: string): number {
  for (let i = 0; i < LEARNING_PATH.length; i++) {
    if (LEARNING_PATH[i].id === levelId) return i
  }
  return -1
}

function getLevelAt(index: number): LearningLevel | undefined {
  return LEARNING_PATH[index]
}

/** 默认状态：从第 0 级开始（无持久化状态时由 resolveCurrentLevel 走迁移反推） */
function createDefaultState(): AutoLevelState {
  const first = getLevelAt(0)
  return {
    version: AUTO_LEVEL_STATE_VERSION,
    levelId: first ? first.id : '',
    startedAt: Date.now(),
    skipped: {},
    suspended: [],
  }
}

function normalizeCachedInfo(raw: unknown): AutoLevelCachedInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string') return undefined
  const info: AutoLevelCachedInfo = {
    name: obj.name,
    total: sanitizeNonNegativeInt(obj.total),
    seen: sanitizeNonNegativeInt(obj.seen),
    mastered: sanitizeNonNegativeInt(obj.mastered),
    suspendedCount: sanitizeNonNegativeInt(obj.suspendedCount),
    due: sanitizeNonNegativeInt(obj.due),
    newRatio: isFiniteNumber(obj.newRatio) ? Math.min(1, Math.max(0, obj.newRatio)) : 0,
    updatedAt: isFiniteNumber(obj.updatedAt) ? obj.updatedAt : Date.now(),
  }
  return info
}

/** 容错解析：任意损坏 JSON/字段类型都回退到默认值，不抛错 */
function normalizeState(raw: unknown): AutoLevelState {
  const base = createDefaultState()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  // v9.3.1（SRS-007）：未知/更高版本不 throw、不整份丢弃，按已知字段安全降级解析（旧版无 version 视为 0）
  const rawVersion = isFiniteNumber(obj.version) ? obj.version : 0
  if (rawVersion > AUTO_LEVEL_STATE_VERSION) {
    console.warn(`[autoLevel] qzAutoLevelState version=${rawVersion} 高于当前 ${AUTO_LEVEL_STATE_VERSION}，按已知字段降级解析`)
  }

  const levelId = typeof obj.levelId === 'string' && obj.levelId ? obj.levelId : base.levelId
  const startedAt = isFiniteNumber(obj.startedAt) ? obj.startedAt : base.startedAt

  const skipped: Record<string, number> = {}
  if (obj.skipped && typeof obj.skipped === 'object') {
    const source = obj.skipped as Record<string, unknown>
    for (const key of Object.keys(source)) {
      if (!key) continue
      const count = sanitizeNonNegativeInt(source[key])
      if (count > 0) skipped[key] = count
    }
  }

  const suspended: string[] = []
  if (Array.isArray(obj.suspended)) {
    for (const item of obj.suspended) {
      if (typeof item === 'string' && item && suspended.indexOf(item) < 0) suspended.push(item)
    }
  }

  const state: AutoLevelState = {
    version: AUTO_LEVEL_STATE_VERSION,
    levelId,
    startedAt,
    skipped,
    suspended,
  }
  // v9.3.1（SRS-005）：外部恢复检测用快照（只读保留，不在这里和 suspended 对齐——对齐只发生在写入时）
  if (Array.isArray(obj.suspendedSnapshot)) {
    const snapshot: string[] = []
    for (const item of obj.suspendedSnapshot) {
      if (typeof item === 'string' && item && snapshot.indexOf(item) < 0) snapshot.push(item)
    }
    state.suspendedSnapshot = snapshot
  }
  if (isFiniteNumber(obj.lastLevelUpAt)) state.lastLevelUpAt = obj.lastLevelUpAt
  const cached = normalizeCachedInfo(obj.cached)
  if (cached) state.cached = cached
  return state
}

/** 读取原始状态；无键/损坏时返回 null（调用方据此决定是否走迁移反推） */
function readStoredState(): AutoLevelState | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(AUTO_LEVEL_STORAGE_KEY)
    if (!raw) return null
    return normalizeState(JSON.parse(raw))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 状态持久化
// ---------------------------------------------------------------------------

/** 读取状态（容错；无状态时返回从第 0 级开始的默认值，不写盘） */
export function loadAutoLevelState(): AutoLevelState {
  return readStoredState() || createDefaultState()
}

/** 是否已有持久化状态（首次使用/导入后可用于判断是否需要迁移反推） */
export function hasAutoLevelState(): boolean {
  return readStoredState() !== null
}

/** 状态持久化失败计数（v9.3.1 / SRS-006：供测试与数据页展示，不参与业务判定） */
let persistFailureCount = 0
/** 已发生的状态持久化失败次数（成功写入不清零，方便用户发现问题后仍能看到历史） */
export function getStatePersistFailures(): number {
  return persistFailureCount
}

function reportStatePersistFailure(reason: string, error?: unknown): void {
  persistFailureCount += 1
  try {
    console.warn(`[autoLevel] qzAutoLevelState 持久化失败（${reason}），自动进阶进度可能会丢失`, error)
  } catch {
    // console 不可用时静默
  }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent(AUTO_LEVEL_STATE_ERROR_EVENT, { detail: { message: reason, at: Date.now() } }))
    }
  } catch {
    // 非浏览器环境/事件构造失败时忽略：派发失败不影响返回值
  }
}

/** 保存状态（容错；localStorage 不可用或 quota 超限时返回 false，并 console.warn + 派发事件） */
export function saveAutoLevelState(state: AutoLevelState): boolean {
  const storage = getStorage()
  if (!storage) {
    reportStatePersistFailure('localStorage 不可用')
    return false
  }
  try {
    const normalized = normalizeState(state)
    storage.setItem(AUTO_LEVEL_STORAGE_KEY, JSON.stringify(normalized))
    return true
  } catch (e) {
    reportStatePersistFailure('写入异常（可能为 quota 超限/隐私模式）', e)
    return false
  }
}

/**
 * 状态修改的唯一入口（v9.3.1 / SRS-003）：**同步**读最新 localStorage → 原地修改 → 写回。
 * 体内禁止 await/异步回调，保证「读-改-写」原子；调用方不得再自己持有旧快照整对象回写。
 * mutator 返回 `true` 表示确有变化（才会写盘），返回 `false`/undefined 则不写，避免每词一次无谓落盘。
 *
 * v9.3.1（SRS-005）：只有**确实改动了 suspended** 时才同步 `suspendedSnapshot`，
 * 这样「只更新 cached」的写入（数据页 getCachedInfo）不会把外部恢复检测线索冲掉。
 */
function mutateStateWithResult(mutator: (draft: AutoLevelState) => boolean): {
  state: AutoLevelState
  changed: boolean
  persisted: boolean
} {
  const draft = loadAutoLevelState()
  const suspendedBefore = JSON.stringify(draft.suspended)
  let changed = false
  try {
    changed = mutator(draft) === true
  } catch (e) {
    console.warn('[autoLevel] mutateState mutator failed', e)
    changed = false
  }
  if (!changed) return { state: draft, changed: false, persisted: true }
  const normalized = normalizeState(draft)
  if (JSON.stringify(normalized.suspended) !== suspendedBefore) {
    normalized.suspendedSnapshot = normalized.suspended.slice()
  } else if (!Array.isArray(normalized.suspendedSnapshot)) {
    // 首次写入补基线快照，保证之后「外部清空 suspended」可被检测
    normalized.suspendedSnapshot = normalized.suspended.slice()
  }
  const persisted = saveAutoLevelState(normalized)
  return { state: normalized, changed: true, persisted }
}

function mutateState(mutator: (draft: AutoLevelState) => boolean): AutoLevelState {
  return mutateStateWithResult(mutator).state
}

/** 只把 patch 里 `!== undefined` 的字段覆盖到 draft（避免显式 undefined 冲掉已有值） */
function applyDefinedFields(draft: AutoLevelState, patch: Partial<AutoLevelState>): void {
  const target = draft as Record<string, unknown>
  for (const key of Object.keys(patch) as Array<keyof AutoLevelState>) {
    const value = patch[key]
    if (value !== undefined) target[key] = value
  }
}

/** 浅合并补丁；skipped/suspended 未传时保留原值，传入时整体替换（传入值会被 sanitize） */
export function patchState(patch: Partial<AutoLevelState>): AutoLevelState {
  return mutateState((draft) => {
    applyDefinedFields(draft, patch)
    draft.version = AUTO_LEVEL_STATE_VERSION
    return true
  })
}

// ---------------------------------------------------------------------------
// v9.6（Batch3 / DATA-003 收尾）：旧 key（trim+lower）状态键迁移
// ---------------------------------------------------------------------------

/**
 * 旧 key 迁移结果（migrateAutoLevelStateKeys 返回）。
 * - `changed`：本次是否真正改写了 localStorage（无变化/写失败均为 false）；
 * - `persisted`：是否已落盘（无变化视为已落盘；写失败为 false，调用方应保留重试机会）；
 * - `skippedMoved` / `suspendedMoved` / `snapshotMoved`：被改名的条目数
 *   （写失败时表示「本应改名」的数量）。
 */
export type AutoLevelKeyMigrationResult = {
  changed: boolean
  persisted: boolean
  skippedMoved: number
  suspendedMoved: number
  snapshotMoved: number
}

/** 把 Map / 普通对象形态的映射统一成只含「合法且非同值」条目的 Map（非法输入一律忽略） */
function normalizeKeyRenameMap(legacyToNewKeyMap: Map<string, string> | Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  if (!legacyToNewKeyMap || typeof legacyToNewKeyMap !== 'object') return map
  const entries: Array<[string, string]> =
    legacyToNewKeyMap instanceof Map
      ? Array.from(legacyToNewKeyMap.entries())
      : Object.keys(legacyToNewKeyMap).map((key) => [key, legacyToNewKeyMap[key]] as [string, string])
  for (const [from, to] of entries) {
    if (typeof from !== 'string' || !from) continue
    if (typeof to !== 'string' || !to || to === from) continue
    map.set(from, to)
  }
  return map
}

/**
 * v9.6（Batch3 / DATA-003 收尾）：把 `qzAutoLevelState` 里旧 schema 的状态键
 * （v9.4 及之前的 `trim + lower` memoryKey）改名成 v9.5 的新 key（保留大小写），
 * 修复「March / march 混用时 Skip 计数与挂起状态对新 key 对不上」的遗留问题。
 *
 * 迁移范围（**同步**读-改-写，整份状态一次 setItem 原子落盘）：
 * - `skipped`：旧 key → 新 key；同一词在新旧两套 key 下各有一份计数时**相加**——
 *   v9.4 的历史计数与 v9.5 之后的计数属于同一个词，取 max 会丢历史；改名会删掉旧 key，
 *   重复调用不会重复累加（不是复制）；
 * - `suspended`：按映射改名并去重（旧 key 与新 key 同时挂起时只保留新 key）；
 * - `suspendedSnapshot`：同步改名（v9.3.1 的外部恢复对账依赖它；只改 suspended 不改快照，
 *   下次启动会把迁移过的挂起词误判成「被外部恢复」，进而误复位 lapses）。
 *
 * 幂等：无旧 key / 无变化时直接返回且不写盘；重复调用第二次返回 `changed=false`。
 * 只改名、不新增挂起：合并后计数即使 >= AUTO_LEVEL_SUSPEND_THRESHOLD 也不在这里补挂起
 * （迁移只负责「换 key」，保持用户当前可见的待攻克集合不变；下一次 Skip 仍按阈值正常挂起）。
 * 本函数不加载词库、不 import db：映射由调用方（memory.ts 的 memoryKeyCaseV2 迁移）构建后传入。
 *
 * @param legacyToNewKeyMap 旧 key → 新 key 映射；同值条目会被忽略
 */
export function migrateAutoLevelStateKeys(legacyToNewKeyMap: Map<string, string> | Record<string, string>): AutoLevelKeyMigrationResult {
  const renameMap = normalizeKeyRenameMap(legacyToNewKeyMap)
  const result: AutoLevelKeyMigrationResult = {
    changed: false,
    persisted: true,
    skippedMoved: 0,
    suspendedMoved: 0,
    snapshotMoved: 0,
  }
  if (renameMap.size === 0) return result

  const state = loadAutoLevelState()

  const skipped: Record<string, number> = {}
  for (const key of Object.keys(state.skipped)) {
    const count = sanitizeNonNegativeInt(state.skipped[key])
    if (count <= 0) continue
    const target = renameMap.get(key) || key
    if (target !== key) result.skippedMoved += 1
    skipped[target] = sanitizeNonNegativeInt(skipped[target]) + count
  }

  const renameKeys = (keys: string[]): { keys: string[]; moved: number } => {
    const renamed: string[] = []
    let moved = 0
    for (const key of keys) {
      const target = renameMap.get(key) || key
      if (target !== key) moved += 1
      if (renamed.indexOf(target) < 0) renamed.push(target)
    }
    return { keys: renamed, moved }
  }

  const suspended = renameKeys(state.suspended)
  const snapshot = Array.isArray(state.suspendedSnapshot) ? renameKeys(state.suspendedSnapshot) : null

  // 变化判定用序列化比较：改名/合并/去重任一发生即需写回
  const skippedChanged = JSON.stringify(skipped) !== JSON.stringify(state.skipped)
  const suspendedChanged = JSON.stringify(suspended.keys) !== JSON.stringify(state.suspended)
  const snapshotChanged = snapshot ? JSON.stringify(snapshot.keys) !== JSON.stringify(state.suspendedSnapshot) : false
  if (!skippedChanged && !suspendedChanged && !snapshotChanged) return result

  result.suspendedMoved = suspended.moved
  result.snapshotMoved = snapshot ? snapshot.moved : 0

  const nextState: AutoLevelState = { ...state, skipped, suspended: suspended.keys }
  if (snapshot) nextState.suspendedSnapshot = snapshot.keys
  result.changed = saveAutoLevelState(nextState)
  result.persisted = result.changed
  return result
}

// ---------------------------------------------------------------------------
// Skip / suspended
// ---------------------------------------------------------------------------

function suspendedWordOfKey(key: string): string {
  const separator = key.indexOf('::')
  const word = separator >= 0 ? key.slice(separator + 2) : key
  return normalizeWordName(word)
}

/** 本级 words 中处于挂起状态的词名集合（按 word 匹配，兼容任意 dict 命名空间） */
function buildSuspendedWordSet(state: AutoLevelState): Set<string> {
  const set = new Set<string>()
  for (const key of state.suspended) {
    const word = suspendedWordOfKey(key)
    if (word) set.add(word)
  }
  return set
}

/** 该词是否已挂起（按 memoryKey 精确匹配） */
export function isSuspended(dict: string, word: string): boolean {
  const key = memoryKey(dict, word)
  const state = loadAutoLevelState()
  return state.suspended.indexOf(key) >= 0
}

/** 全部挂起词的 memoryKey 列表（供「待攻克」列表/数据页） */
export function getSuspendedKeys(): string[] {
  return loadAutoLevelState().suspended.slice()
}

/**
 * 记录一次 Skip（Skip 按钮 / Ctrl+Shift+→ 下一词 / 复习跳过都调用）。
 * 达到 AUTO_LEVEL_SUSPEND_THRESHOLD 后自动 suspended，不阻塞本级升级。
 * v9.3.1（SRS-003）：走 mutateState 同步「读最新 → 改 → 写」，不再持有可能过期的整份快照。
 */
export function recordSkip(dict: string, word: string): SkipRecordResult {
  const name = normalizeWordName(word)
  if (!dict || !name) return { count: 0, suspended: false, persisted: true }
  const key = memoryKey(dict, word)
  let count = 0
  let suspended = false
  const { persisted } = mutateStateWithResult((draft) => {
    count = sanitizeNonNegativeInt(draft.skipped[key]) + 1
    draft.skipped[key] = count
    suspended = draft.suspended.indexOf(key) >= 0
    if (!suspended && count >= AUTO_LEVEL_SUSPEND_THRESHOLD) {
      draft.suspended.push(key)
      suspended = true
    }
    return true
  })
  return { count, suspended, persisted }
}

/**
 * 清除一个词的 Skip 记录与挂起状态（词已完整作答/删除记录时调用）。
 * 返回是否发生了变更（幂等，可安全重复调用）。
 */
export function clearSkip(dict: string, word: string): boolean {
  if (!dict || !normalizeWordName(word)) return false
  const key = memoryKey(dict, word)
  return mutateStateWithResult((draft) => {
    let changed = false
    if (Object.prototype.hasOwnProperty.call(draft.skipped, key)) {
      delete draft.skipped[key]
      changed = true
    }
    const index = draft.suspended.indexOf(key)
    if (index >= 0) {
      draft.suspended.splice(index, 1)
      changed = true
    }
    return changed
  }).changed
}

/**
 * 手动/leech 挂起一个词（不增加 Skip 计数）；自动进阶不再出该词，进「待攻克」。
 * 返回是否新增（已挂起返回 false）。
 */
export function suspendWord(dict: string, word: string): boolean {
  if (!dict || !normalizeWordName(word)) return false
  const key = memoryKey(dict, word)
  return mutateStateWithResult((draft) => {
    if (draft.suspended.indexOf(key) >= 0) return false
    draft.suspended.push(key)
    return true
  }).changed
}

/**
 * 恢复一个挂起词：移出 suspended、清零 Skip 计数（给 3 次新机会），
 * 并**复位该词的 lapses**（v9.3.1 / SRS-005：不然 leech 词（lapses>=4）恢复后答错一次就被
 * db/index.ts 的 `lapses>=4 → suspendWord` 立即重新挂起，「3 次新机会」形同虚设）。
 * 复位 lapses 需要写 IndexedDB，用动态 import 异步尽力而为（失败只 console.warn，不影响返回值）。
 * 返回是否发生变更。
 */
export function resumeWord(dict: string, word: string): boolean {
  if (!dict || !normalizeWordName(word)) return false
  const key = memoryKey(dict, word)
  const { changed } = mutateStateWithResult((draft) => {
    let dirty = false
    const index = draft.suspended.indexOf(key)
    if (index >= 0) {
      draft.suspended.splice(index, 1)
      dirty = true
    }
    if (Object.prototype.hasOwnProperty.call(draft.skipped, key)) {
      delete draft.skipped[key]
      dirty = true
    }
    return dirty
  })
  if (changed) void resetLapsesByKey(key)
  return changed
}

/** SRS-005：把单个词的 lapses 复位（0），使其需要重新累计到阈值才会再次被自动挂起 */
async function resetLapsesByKey(key: string): Promise<boolean> {
  try {
    // 动态 import：避免 autoLevel ↔ db/index 在应用启动期形成 TDZ 循环（db 侧也是反向动态 import 本模块）
    const { db } = await import('@/utils/db')
    const rec = await db.memoryRecords.get(key)
    if (!rec) return false
    const expected = Number(rec.lapses) || 0
    if (expected <= 0) return false
    // CAS：读取后又发生了一次作答（lapses 已变）就放弃复位，避免把刚累计的 lapse 冲掉
    const latest = await db.memoryRecords.get(key)
    if (!latest || (Number(latest.lapses) || 0) !== expected) return false
    latest.lapses = 0
    await db.memoryRecords.put(latest)
    // 清 memoryCache：让该词以「复位后的记录」重新进入可选池（下次 getMemoryRecords 从 DB 重读）
    clearMemoryCache()
    return true
  } catch (e) {
    console.warn('[autoLevel] 恢复待攻克时复位 lapses 失败（下次答错仍可能立即重新挂起）', e)
    return false
  }
}

/**
 * v9.3.1（SRS-005）：找出「被外部恢复」的挂起词。
 * 增强面板的「恢复全部待攻克」是 enhance.js 直接 `localStorage.setItem(清空 suspended)` +
 * `location.reload()`，不会调用 resumeWord，所以只能靠启动时对账：
 * `suspendedSnapshot`（本模块最后一次写入时已知的 suspended）减去当前 `suspended` = 被恢复的词。
 * 返回被恢复的 key 列表（同时把快照与当前 suspended 对齐，幂等）。
 */
export function takePendingResumes(): string[] {
  const current = loadAutoLevelState()
  const known = Array.isArray(current.suspendedSnapshot) ? current.suspendedSnapshot : []
  const suspendedSet = new Set(current.suspended)
  const pending = known.filter((key) => !suspendedSet.has(key))
  const snapshotBefore = JSON.stringify(known)
  const snapshotAfter = JSON.stringify(current.suspended)
  if (snapshotBefore !== snapshotAfter) {
    mutateState((draft) => {
      draft.suspendedSnapshot = draft.suspended.slice()
      return true
    })
  }
  return pending
}

/**
 * v9.3.1（SRS-005）：启动对账入口（memory 初始化时调用一次）。
 * 对外部恢复的挂起词复位 lapses，使「恢复待攻克」在真实 UI 路径（enhance.js 直接改 localStorage）
 * 下也生效：否则 leech 词（lapses>=4）恢复后答错一次就会被 db 再次挂起。
 *
 * @returns 实际复位了 lapses 的词数
 */
export async function applyPendingResumeLapses(): Promise<number> {
  const keys = takePendingResumes()
  if (!keys.length) return 0
  let reset = 0
  for (const key of keys) {
    if (await resetLapsesByKey(key)) reset += 1
  }
  if (keys.length) {
    console.info(`[autoLevel] 检测到外部恢复 ${keys.length} 个待攻克词，已复位 ${reset} 条的 lapses`)
  }
  return reset
}

// ---------------------------------------------------------------------------
// 记录索引：按 word 取「最优」memoryRecord（跨级/跨词库同词去重）
// ---------------------------------------------------------------------------

/** 越大越优：stage 高 → correct 大 → lastSeen 新 → attempts 多 */
function compareRecords(a: IMemoryRecord, b: IMemoryRecord): number {
  const stageA = Number(a.stage) || 0
  const stageB = Number(b.stage) || 0
  if (stageA !== stageB) return stageA - stageB
  const correctA = Number(a.correct) || 0
  const correctB = Number(b.correct) || 0
  if (correctA !== correctB) return correctA - correctB
  const lastSeenA = Number(a.lastSeen) || 0
  const lastSeenB = Number(b.lastSeen) || 0
  if (lastSeenA !== lastSeenB) return lastSeenA - lastSeenB
  return (Number(a.attempts) || 0) - (Number(b.attempts) || 0)
}

function buildBestRecordMap(records: IMemoryRecord[]): Map<string, IMemoryRecord> {
  const best = new Map<string, IMemoryRecord>()
  for (const record of records) {
    if (!record || !record.word) continue
    const key = normalizeWordName(record.word)
    if (!key) continue
    const prev = best.get(key)
    if (!prev || compareRecords(record, prev) > 0) best.set(key, record)
  }
  return best
}

// ---------------------------------------------------------------------------
// 级别进度
// ---------------------------------------------------------------------------

function makeWord(word: Word): Word {
  const trans = Array.isArray(word.trans) ? word.trans.filter((item) => typeof item === 'string') : []
  const result: Word = {
    name: String(word.name),
    trans,
    usphone: typeof word.usphone === 'string' ? word.usphone : '',
    ukphone: typeof word.ukphone === 'string' ? word.ukphone : '',
  }
  if (word.notation) result.notation = word.notation
  if (word.dict) result.dict = word.dict
  return result
}

/** 加载级别词表；把「抛错或空词表」视为加载失败（LEARNING_PATH 各级不应为空） */
async function loadLevelWordList(level: LearningLevel): Promise<{ words: Word[]; error?: 'load-failed' }> {
  let loaded: Word[] = []
  try {
    loaded = await loadLevelWords(level)
  } catch {
    return { words: [], error: 'load-failed' }
  }
  if (!Array.isArray(loaded) || loaded.length === 0) {
    return { words: [], error: 'load-failed' }
  }
  const seen = new Set<string>()
  const words: Word[] = []
  for (const word of loaded) {
    if (!word || !word.name) continue
    const key = normalizeWordName(word.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    words.push(makeWord(word))
  }
  if (!words.length) return { words: [], error: 'load-failed' }
  return { words }
}

function calculateNewRatio(due: number): number {
  if (due <= 0) return 1
  if (due <= 20) return 0.4
  if (due <= 100) return 0.2
  if (due < 300) return 0.1
  return 0.02
}

function calculateRefreshChance(due: number): number {
  if (due <= 20) return 0.12
  if (due <= 100) return 0.03
  return 0
}

/** 建议新词比例（memory.ts 出词可按此动态配比；不设硬性每日上限） */
export function getNewRatio(due: number): number {
  return calculateNewRatio(sanitizeNonNegativeInt(due))
}

/** 建议随机回顾概率（due 越多越低；>100 关闭） */
export function getRefreshChance(due: number): number {
  return calculateRefreshChance(sanitizeNonNegativeInt(due))
}

/**
 * 展示口径的「到期词数」：按 **word**（跨词库同名只算 1）去重，且排除已挂起（待攻克）的词。
 *
 * v9.3.1（SRS-001/002）：
 * - 取词 due 池按 key（dict+word）去重；这里展示口径按 word 去重，与旧版/门禁 B-18 的展示语义一致
 *   （同词跨词库有 2 条记录时顶栏显示 1 个复习债，而不是 2）；
 * - 已 suspended 的到期词不再计入复习债，与出词池排除挂起词的口径一致（否则出现「显示 1 个复习债，
 *   但取词永远只能取到别的词」）；
 * - due 用 `effectiveDueOf`（时钟回拨/未来 lastSeen 校正），保证与 memory.ts 的到期判定同源。
 */
function countDueWords(records: IMemoryRecord[]): number {
  const now = Date.now()
  const state = loadAutoLevelState()
  const suspended = new Set(state.suspended)
  const seen = new Set<string>()
  for (const record of records) {
    if (!record || !record.word) continue
    const key = record.key || memoryKey(record.dict, record.word)
    if (!key || suspended.has(key)) continue
    const due = effectiveDueOf(now, record)
    if (due <= 0) continue
    if (isDue(now, due)) seen.add(normalizeWordName(record.word))
  }
  return seen.size
}

function buildCachedInfo(progress: LevelProgress, due: number): AutoLevelCachedInfo {
  return {
    name: progress.name,
    total: progress.total,
    seen: progress.seen,
    mastered: progress.mastered,
    suspendedCount: progress.suspended,
    due,
    newRatio: calculateNewRatio(due),
    updatedAt: Date.now(),
  }
}

/**
 * 计算指定级别（默认持久化的当前级别）的进度。
 *
 * 判据（v9.3）：
 * - required = 本级词 - suspended（按 word 匹配，任意 dict）；
 * - required.length === 0 → done；
 * - seen === required 且 mastered / required >= MASTERY_RATIO（v9.11：0.85）→ done；
 * - 词库加载失败 → error='load-failed' 且 done=false（不判完成）。
 */
export async function computeLevelProgress(records: IMemoryRecord[], levelId?: string): Promise<LevelProgress> {
  const state = loadAutoLevelState()
  const requestedLevelId = levelId || state.levelId
  let index = findLevelIndex(requestedLevelId)
  if (index < 0) index = 0 // 词库路径变更/脏 id：退回第 0 级（resolveCurrentLevel 会走迁移反推）
  const level = getLevelAt(index)
  if (!level) {
    return {
      levelId: requestedLevelId,
      index: 0,
      name: '',
      total: 0,
      required: 0,
      seen: 0,
      mastered: 0,
      suspended: 0,
      unseen: 0,
      newWords: [],
      done: false,
      error: 'load-failed',
    }
  }

  const loaded = await loadLevelWordList(level)
  if (loaded.error) {
    return {
      levelId: level.id,
      index,
      name: level.name,
      total: 0,
      required: 0,
      seen: 0,
      mastered: 0,
      suspended: 0,
      unseen: 0,
      newWords: [],
      done: false,
      error: 'load-failed',
    }
  }

  const suspendedWords = buildSuspendedWordSet(state)
  const bestRecords = buildBestRecordMap(records)

  let suspendedCount = 0
  let requiredCount = 0
  let seenCount = 0
  let masteredCount = 0
  const newWords: Word[] = []

  for (const word of loaded.words) {
    const key = normalizeWordName(word.name)
    if (suspendedWords.has(key)) {
      suspendedCount += 1
      continue
    }
    requiredCount += 1
    const record = bestRecords.get(key) || null
    if (!record) {
      newWords.push(word)
      continue
    }
    seenCount += 1
    if (isMastered(record)) masteredCount += 1
  }

  const required = requiredCount
  const done = required === 0 ? true : seenCount === required && masteredCount / required >= MASTERY_RATIO

  return {
    levelId: level.id,
    index,
    name: level.name,
    total: loaded.words.length,
    required,
    seen: seenCount,
    mastered: masteredCount,
    suspended: suspendedCount,
    unseen: newWords.length,
    newWords,
    done,
  }
}

function dispatchLevelUp(detail: LevelUpDetail): void {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(AUTO_LEVEL_UP_EVENT, { detail }))
    }
  } catch {
    // 非浏览器环境/事件构造失败时静默：不影响状态推进
  }
}

/**
 * 从持久化级别出发，若完成则逐级向前推进（只升不回退）。
 * 每次跨级写 lastLevelUpAt 并 dispatch `qz-auto-level-up`；最后写入 cached。
 * 下一级加载失败时：不推进 levelId，返回该失败级别的 error 进度，等下次重试。
 */
export async function advanceIfComplete(records: IMemoryRecord[]): Promise<AdvanceResult> {
  const state = loadAutoLevelState()
  let progress = await computeLevelProgress(records, state.levelId)
  const levelUps: LevelUpDetail[] = []

  if (!progress.error) {
    let current = progress
    while (current.done && current.index < LEARNING_PATH.length - 1) {
      const nextLevel = getLevelAt(current.index + 1)
      if (!nextLevel) break
      const nextProgress = await computeLevelProgress(records, nextLevel.id)
      if (nextProgress.error) {
        // 失败级别不判完成，也不写入 levelId（保持原级别，下次重试）
        progress = nextProgress
        break
      }
      const at = Date.now()
      levelUps.push({ from: current.levelId, to: nextProgress.levelId, levelId: nextProgress.levelId, name: nextProgress.name, at })
      progress = nextProgress
      if (!nextProgress.done) break
      current = nextProgress
    }
  }

  // v9.3.1（SRS-003）：跨 await 之后**重新读最新状态再合并**，只写本函数负责的字段
  // （cached / levelId / lastLevelUpAt），绝不拿进入函数时的旧快照整对象回写，
  // 否则会冲掉并发发生的 recordSkip/suspendWord/resumeWord（实测 holdFile 窗口可稳定复现）。
  // 同时保证「只升不回退」：只有当目标级别下标更大时才写 levelId（多实例/并发调用也不会回退）。
  const lastLevelUp = levelUps.length > 0 ? levelUps[levelUps.length - 1] : null
  const nextState = mutateState((draft) => {
    let changed = false
    if (!progress.error) {
      draft.cached = buildCachedInfo(progress, countDueWords(records))
      changed = true
    }
    if (lastLevelUp) {
      const currentIndex = findLevelIndex(draft.levelId)
      const targetIndex = findLevelIndex(lastLevelUp.levelId)
      if (currentIndex < 0 || targetIndex > currentIndex) {
        draft.levelId = lastLevelUp.levelId
        draft.lastLevelUpAt = lastLevelUp.at
        changed = true
      }
    }
    return changed
  })
  for (const detail of levelUps) dispatchLevelUp(detail)
  return { progress, levelUps, state: nextState }
}

/**
 * 当前级别（集成入口）：有持久化状态时从该级别出发只升不回退；
 * 首次使用 / 状态损坏 / 级别 id 不在路径中时，按旧逻辑（第一个有未学词的级别）
 * 反推并持久化，避免老用户升级后被拉回第 1 级。
 */
export async function resolveCurrentLevel(records: IMemoryRecord[]): Promise<LevelProgress> {
  const stored = readStoredState()
  if (!stored || findLevelIndex(stored.levelId) < 0) {
    return reevaluateLevel(records, { migrate: true })
  }
  const result = await advanceIfComplete(records)
  return result.progress
}

type ReevaluateOptions = {
  /** true=首次迁移：按旧逻辑「第一个存在未学词的级别」定位，不要求掌握率 */
  migrate?: boolean
}

/**
 * 显式重新评估（数据页「重新评估级别」/首次迁移）：从第 0 级开始扫描。
 * - migrate=true：第一个仍有未学词（required 中 unseen>0）的级别；
 * - migrate=false：第一个未完成的级别（新判据）。
 * 会覆盖持久化的 levelId（这是唯一允许回退的入口），不 dispatch 升级事件。
 */
export async function reevaluateLevel(records: IMemoryRecord[], options: ReevaluateOptions = {}): Promise<LevelProgress> {
  const state = loadAutoLevelState()
  const firstLevel = getLevelAt(0)
  if (!firstLevel) {
    return {
      levelId: state.levelId,
      index: 0,
      name: '',
      total: 0,
      required: 0,
      seen: 0,
      mastered: 0,
      suspended: 0,
      unseen: 0,
      newWords: [],
      done: false,
      error: 'load-failed',
    }
  }

  let progress = await computeLevelProgress(records, firstLevel.id)
  let index = progress.index
  // v9.3 设计：首次迁移（migrate=true）按「第一个仍有未学词的级别」定位（旧逻辑）；
  // 数据页显式重评（migrate=false）按「第一个未完成的级别」（已见 100% + 掌握≥85%）定位。
  // 之前实现忽略了 options.migrate（参数成死参数），导致 B-07a 迁移路径与门禁 B-07a.migrateNote 不符。
  const migrate = options.migrate === true

  while (!progress.error && index < LEARNING_PATH.length - 1) {
    if (migrate ? progress.unseen <= 0 : !progress.done) {
      // migrate=true：本级已无未学词（全 seen，即使未掌握）→ 继续看下一级；
      // migrate=false：本级未完成 → 停在本级。
      if (!migrate) break
    } else {
      break
    }
    const nextLevel = getLevelAt(index + 1)
    if (!nextLevel) break
    const nextProgress = await computeLevelProgress(records, nextLevel.id)
    if (nextProgress.error) {
      // 加载失败：停在该级别并返回 error，不判完成
      progress = nextProgress
      break
    }
    progress = nextProgress
    index = nextProgress.index
    if (progress.done) continue
    break
  }

  // v9.3.1（SRS-003）：reevaluate 是唯一允许回退 levelId 的入口，但同样只合并本函数负责的字段，
  // 不再用进入函数时的旧快照整对象回写（否则跨 await 期间并发的 skip/suspend 会丢失）。
  if (!progress.error) {
    mutateState((draft) => {
      draft.levelId = progress.levelId
      draft.cached = buildCachedInfo(progress, countDueWords(records))
      return true
    })
  }
  return progress
}

/**
 * 读取并写回 cached（顶栏/数据页用）。
 * 只计算持久化级别的进度（不推进级别）；需要推进请先调 resolveCurrentLevel。
 */
export async function getCachedInfo(records: IMemoryRecord[]): Promise<AutoLevelCachedInfo> {
  const progress = await computeLevelProgress(records)
  if (progress.error) {
    // 加载失败：不覆盖已有缓存，避免顶栏显示 0/0；无缓存时返回占位
    return loadAutoLevelState().cached || buildCachedInfo(progress, countDueWords(records))
  }
  const cached = buildCachedInfo(progress, countDueWords(records))
  patchState({ cached })
  return cached
}

/** 当前持久化级别 id（默认第 0 级；不读词表，O(1)） */
export function getPersistedLevelId(): string {
  return loadAutoLevelState().levelId
}

/** 级别名查询（未知返回空串） */
export function getLevelName(levelId: string): string {
  const index = findLevelIndex(levelId)
  const level = index >= 0 ? getLevelAt(index) : undefined
  return level ? level.name : ''
}

/** 当前级别在路径中的下标（未知返回 -1） */
export function getLevelIndex(levelId: string): number {
  return findLevelIndex(levelId)
}

/** 供测试/调试：删除持久化状态（UI 不调用） */
export function clearAutoLevelState(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(AUTO_LEVEL_STORAGE_KEY)
  } catch {
    // ignore
  }
}
