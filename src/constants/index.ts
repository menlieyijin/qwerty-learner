export const EXPLICIT_SPACE = '␣'

export const CHAPTER_LENGTH = 20

export const DISMISS_START_CARD_DATE_KEY = 'dismissStartCardDate'

/**
 * v9.12（M2-011）：localStorage 会话状态键的唯一来源。
 *
 * 这些键原先在 `utils/db/data-export.ts` 里以字面量出现（导入后清理），改键名就会静默失效。
 * 必须与各自的原子/读写方共用同一份常量；`qzAutoLevelState` 的常量在 `utils/autoLevel.ts`
 * （`AUTO_LEVEL_STORAGE_KEY`），这里不重复定义。
 */
/** 数据页「重新评估级别」标记（`useWordList` 消费） */
export const REVALUATE_LEVEL_STORAGE_KEY = 'qzReevaluateLevel'
/** 增强面板 → 练习页的「到期复习」词表桥接（`pages/Typing` 消费） */
export const DUE_REVIEW_WORDS_STORAGE_KEY = 'qzDueReviewWords'
/** 复习会话快照（`store/reviewInfoAtom` 的 atomWithStorage 键） */
export const REVIEW_MODE_INFO_STORAGE_KEY = 'reviewModeInfo'

export const CONFETTI_DEFAULTS = {
  colors: ['#5D8C7B', '#F2D091', '#F2A679', '#D9695F', '#8C4646'],
  shapes: ['square'],
  ticks: 500,
} as confetti.Options

/** 字号默认值：唯一来源（「恢复默认」与 atom 初值都引用它） */
export const defaultFontSizeConfig = {
  foreignFont: 48,
  translateFont: 18,
}

/** v7 升级收敛：旧版「字号过大」的判定阈值（原裸字面量 30/80 在 src/index.tsx） */
export const LEGACY_FONT_SIZE_LIMIT = {
  foreignFont: 80,
  translateFont: 30,
}

/** v7 升级收敛：超过阈值时写入的字号（原裸字面量 64/22 在 src/index.tsx） */
export const LEGACY_FONT_SIZE_REPAIR = {
  foreignFont: 64,
  translateFont: 22,
}
