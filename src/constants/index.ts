export const EXPLICIT_SPACE = '␣'

export const CHAPTER_LENGTH = 20

export const DISMISS_START_CARD_DATE_KEY = 'dismissStartCardDate'

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
