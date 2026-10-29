import { AUTO_LEVEL_STORAGE_KEY, getLevelIndex, loadAutoLevelState, patchState } from '@/utils/autoLevel'

/**
 * 首次使用的「词汇水平起点」选择（v9.16，dsh）。
 *
 * 设计取舍：
 * - 只决定**起点级别**（写进 `qzAutoLevelState.levelId`），不改动记忆曲线、不写练习记录；
 *   选完之后仍由既有的自动进阶逻辑（掌握度门禁 85%）负责往后推进，所以它只是「从哪一级开始」。
 * - 选择结果单独持久化在 `qzLearningStart`，与进阶状态解耦：清空学习数据不会把起点选择一起清掉，
 *   用户下次启动不会被重复弹窗（进阶状态被清空时也依然知道用户选过哪一档）。
 * - 已被标记为 `deferred`（用户点了「以后再说」）同样视为「已问过」，不再打扰；入口留在词库页。
 */

export const LEARNING_START_STORAGE_KEY = 'qzLearningStart'

export type LearningStartId = 'none' | 'junior' | 'senior' | 'cet4' | 'cet6'

export type LearningStartState = {
  version: 1
  /** 用户选择；`deferred` 表示「以后再说」（只记录已问过，不应用级别） */
  choiceId: LearningStartId | 'deferred'
  decidedAt: number
}

export type LearningStartOption = {
  id: LearningStartId
  /** 卡片标题 */
  name: string
  /** 对应 LEARNING_PATH 的级别 id */
  levelId: string
  /** 一句话说明（让人知道选完会从哪本词表开始） */
  desc: string
  /** 卡片右上角的档位标签 */
  tag: string
}

/**
 * 五个档次。顺序 = 由浅到深，与 `src/utils/learningPath.ts` 的 LEARNING_PATH 顺序一致。
 * `levelId` 必须是 LEARNING_PATH 里真实存在的 id（有断言脚本覆盖，见 scripts/verify-start-level.mjs）。
 */
export const LEARNING_START_OPTIONS: LearningStartOption[] = [
  {
    id: 'none',
    name: '没学过 / 从零开始',
    levelId: 'primary-1',
    desc: '小学一年级起步，按年级逐级往上走',
    tag: '零基础',
  },
  {
    id: 'junior',
    name: '初中水平',
    levelId: 'junior-1',
    desc: '从初中一年级词表开始，跳过小学阶段',
    tag: '初中',
  },
  {
    id: 'senior',
    name: '高中水平',
    levelId: 'senior-1',
    desc: '从高中必修词表开始，适合已掌握初中词汇',
    tag: '高中',
  },
  {
    id: 'cet4',
    name: '大学四级',
    levelId: 'cet4',
    desc: '从四级核心词表开始，适合高考后 / 备考四级',
    tag: 'CET-4',
  },
  {
    id: 'cet6',
    name: '大学六级',
    levelId: 'cet6',
    desc: '从六级核心词表开始，适合已过四级 / 备考六级',
    tag: 'CET-6',
  },
]

const VALID_CHOICE_IDS = new Set<string>([...LEARNING_START_OPTIONS.map((o) => o.id), 'deferred'])

/** 选择 id → 级别 id（未知返回 null） */
export function levelIdOfChoice(choiceId: string | null | undefined): string | null {
  if (!choiceId) return null
  const hit = LEARNING_START_OPTIONS.find((option) => option.id === choiceId)
  return hit ? hit.levelId : null
}

/** 选择 id → 展示名（未知返回空串） */
export function nameOfChoice(choiceId: string | null | undefined): string {
  if (choiceId === 'deferred') return '未设置'
  const hit = LEARNING_START_OPTIONS.find((option) => option.id === choiceId)
  return hit ? hit.name : ''
}

/**
 * 校验从 localStorage 读回的值（jotai 的 atomWithStorage 只在 JSON 层面做还原，
 * 手改/旧格式的脏数据会直接进组件，这里统一收口）。
 */
export function parseLearningStartState(value: unknown): LearningStartState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const choiceId = raw.choiceId
  if (typeof choiceId !== 'string' || !VALID_CHOICE_IDS.has(choiceId)) return null
  const decidedAt = typeof raw.decidedAt === 'number' && Number.isFinite(raw.decidedAt) ? raw.decidedAt : 0
  return { version: 1, choiceId: choiceId as LearningStartState['choiceId'], decidedAt }
}

export type ApplyStartResult = {
  /** 应用到的级别 id；`deferred` 时为 null */
  levelId: string | null
  /** 起点是否比用户当前所在级别更浅（即这次选择把级别往前挪了） */
  movedBackward: boolean
}

/**
 * 把「起点选择」落到自动进阶状态上。
 *
 * - 只写 `levelId`（不改 startedAt / skipped / suspended / cached 里的历史统计）；
 * - `deferred` 不写任何状态，仅由调用方记录「已问过」；
 * - 这是少数**允许回退级别**的入口之一（另一个是数据页的「重新评估级别」），
 *   因为用户主动改起点时，把级别按旧进度「只升不回退」地卡住会让选择失效。
 */
export function applyLearningStartChoice(choiceId: LearningStartId | 'deferred'): ApplyStartResult {
  const levelId = levelIdOfChoice(choiceId)
  if (!levelId) return { levelId: null, movedBackward: false }

  const currentIndex = getLevelIndex(loadAutoLevelState().levelId)
  const targetIndex = getLevelIndex(levelId)
  const movedBackward = currentIndex >= 0 && targetIndex >= 0 && targetIndex < currentIndex
  patchState({ levelId })
  return { levelId, movedBackward }
}

/**
 * 是否已经在本次进程启动**之前**就有自动进阶状态。
 *
 * 用途：只有真正的「第一次打开」才弹起点选择；老用户（升级上来的、已有学习记录的）
 * 不该被一个必答弹窗拦住。必须在任何异步写入 `qzAutoLevelState` 之前取值，
 * 因此调用点放在模块顶层求值一次（见 `src/components/FirstRunLevelPicker.tsx`）。
 */
export function hasPriorAutoLevelState(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTO_LEVEL_STORAGE_KEY)
    return !!raw && raw !== 'null'
  } catch {
    // localStorage 不可用（隐私模式 / file:// 受限）时按「老用户」处理：宁可不弹，也不要每次启动都弹
    return true
  }
}

/**
 * 同步读取已保存的起点选择。
 *
 * 为什么不用 `learningStartAtom` 的首帧值：`atomWithStorage` 在 jotai 2.x 里是「首帧给 initialValue，
 * 挂载后再从 storage 读」，直接用会在老用户身上闪一帧弹窗。这里在组件初始化时同步读一次，
 * 只用于「要不要弹」的判定；展示与修改仍走 atom（保证跨标签页同步）。
 */
export function readStoredLearningStart(): LearningStartState | null {
  try {
    const raw = window.localStorage.getItem(LEARNING_START_STORAGE_KEY)
    if (!raw) return null
    return parseLearningStartState(JSON.parse(raw))
  } catch {
    return null
  }
}
