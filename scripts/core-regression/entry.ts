/**
 * v9.3 仿真入口：只做 re-export，不改任何 src 实现。
 * 由 build-core.mjs 用 esbuild 打包成 core.mjs（ESM，供 Node 直接 import）。
 */
export {
  MEMORY_MATURE_STAGE,
  MEMORY_MAX_WRONG_DEMOTE,
  MEMORY_SLOW_MS,
  computeDue,
  evaluateWrong,
  shouldCountSlow,
  isMastered,
  isDue,
  correctClockRollback,
  migrateStage,
} from '@/utils/srsRules'

export {
  MEMORY_LADDER,
  MEMORY_LADDER_TEXT,
  MEMORY_GRADUATE_STAGE,
  clampStage,
  ladderDays,
  ladderText,
  nextStage,
  adaptiveDaysFromRecord,
} from '@/utils/memoryLadder'

export { memoryKey, normalizeWordName } from '@/utils/memoryKey'

// v9.5（Batch2 / DATA-003）：memoryKey 大小写拆分相关导出（只增不改，供 verify-batch2 回归使用）
export { legacyMemoryKey, memoryKeyCandidates, normalizeWordKeyWord } from '@/utils/memoryKey'
export { useDeleteWordRecord } from '@/hooks/useRecordMutations'
export {
  MEMORY_KEY_CASE_MIGRATED_KEY,
  AUTO_LEVEL_STATE_KEYS_MIGRATED_KEY,
  migrateMemoryKeyCase,
  canonicalizeMemoryRecords,
  getLearningSummary,
} from '@/utils/memory'

export {
  clearMemoryCache,
  getMemoryCache,
  setMemoryCache,
  upsertMemoryCache,
  removeMemoryCache,
} from '@/utils/memoryCache'

export {
  pushWrongWordRequeue,
  takeRequeueWord,
  removeFromRequeue,
  getSessionRequeueCount,
  clearSessionRequeue,
} from '@/utils/sessionRequeue'

export {
  AUTO_LEVEL_STORAGE_KEY,
  AUTO_LEVEL_STATE_VERSION,
  AUTO_LEVEL_SUSPEND_THRESHOLD,
  AUTO_LEVEL_UP_EVENT,
  migrateAutoLevelStateKeys,
  loadAutoLevelState,
  saveAutoLevelState,
  patchState,
  hasAutoLevelState,
  recordSkip,
  clearSkip,
  suspendWord,
  resumeWord,
  isSuspended,
  getSuspendedKeys,
  computeLevelProgress,
  advanceIfComplete,
  resolveCurrentLevel,
  reevaluateLevel,
  getCachedInfo,
  getNewRatio,
  getRefreshChance,
  MIX_START,
  MIX_FULL,
  MIX_MIN,
  MIX_MAX,
  MIX_MIN_REQUIRED,
  MIX_WINDOW_CAP,
  MIX_WINDOW_SIZE,
  getMixRatio,
  getPersistedLevelId,
  getLevelName,
  getLevelIndex,
  clearAutoLevelState,
} from '@/utils/autoLevel'

export { db, updateMemoryProgress, deferMemoryDue } from '@/utils/db'

export {
  MEMORY_MIGRATED_KEY,
  ensureMemoryMigrated,
  getMemoryRecords,
  pickDynamicWord,
} from '@/utils/memory'

export { LEARNING_PATH, loadLevelWords, loadDictWords } from '@/utils/learningPath'
