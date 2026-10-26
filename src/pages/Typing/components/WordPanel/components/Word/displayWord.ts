import { EXPLICIT_SPACE } from '@/constants'

/**
 * v9.4（TYP-004 / TYP-005）：单词展示串归一化。
 *
 * 背景：Word 组件的判定是「displayWord 与 inputWord 逐字符严格比较」，而 displayWord
 * 来自词库的 name。词库里存在键盘无法产生（或与 ASCII 字形不同）的字符，用户走到该位置
 * 必然判错 → 单词永远无法完成，只能错 4 次后 Skip（并被 v9.3 写成 suspended）。
 *
 * 这里把所有「不可键入 / 字形等价」的字符映射成可键入形式；原始 name 仍用于落库（记忆曲线、
 * 错题本），只有展示与判定使用归一化结果。新增字符时请在下方集中登记，避免再次出现死词。
 *
 * 已处理（2026-10 全量扫描 385 词库 / 457031 词，命中 19 条不可键入 + 286 条空白异常）：
 * - U+00A0 NBSP            → 普通空格
 * - U+2026 … / U+22EF ⋯    → '..'（原文只处理了 …，漏了 ⋯）
 * - U+2010/2011/2012/2013/2014/2015/2212 连字符、en/em dash、减号 → '-'
 * - U+FB00..U+FB06 连字（ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ）→ 对应 ASCII 拼写
 * - U+FFFD 损坏字符 / U+200B..U+200D / U+FEFF → 剔除
 * - 普通空格 → EXPLICIT_SPACE（与原实现一致）
 */
const LIGATURE_MAP: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
}

const NBSP_RE = /\u00A0/g
const ELLIPSIS_RE = /[\u2026\u22EF]/g
// eslint-disable-next-line no-irregular-whitespace
const DASH_RE = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g
const LIGATURE_RE = /[\uFB00-\uFB06]/g
// eslint-disable-next-line no-misleading-character-class -- 需要按码点剔除零宽连接符/损坏字符
const INVISIBLE_RE = /[\uFFFD\u200B\u200C\u200D\uFEFF]/g
const SPACE_RE = / /g

export function normalizeDisplayWord(name: string): string {
  let s = String(name ?? '')
  s = s.replace(NBSP_RE, ' ')
  s = s.replace(ELLIPSIS_RE, '..')
  s = s.replace(DASH_RE, '-')
  s = s.replace(LIGATURE_RE, (ch) => LIGATURE_MAP[ch] ?? ch)
  s = s.replace(INVISIBLE_RE, '')
  return s.replace(SPACE_RE, EXPLICIT_SPACE)
}

/**
 * 归一化后仍存在拉丁键盘无法直接键入的字符（例如未来词库里混入 CJK/emoji/注音符号）。
 * 用于给「坏词条」一个可完成路径：只显示 Skip，不让用户卡死（见 Word 组件）。
 */
// eslint-disable-next-line no-misleading-character-class -- 组合附加符号范围需按码点匹配
const TYPABLE_CHAR_RE = /^[\x20-\x7E\u00A1-\u024F\u1E00-\u1EFF\u02B0-\u02FF\u0300-\u036F]*$/

export function hasUntypableChar(displayWord: string): boolean {
  const stripped = displayWord.split(EXPLICIT_SPACE).join('')
  return !TYPABLE_CHAR_RE.test(stripped)
}

/**
 * v9.5（TYP-012）：把 letterMistake 的下标（**displayWord 下标**）映射成可读字符，供结果页导出/展示。
 *
 * 不能再用 `word.name[index]`：displayWord 与 name 的位置/长度可能不同（空格 → ␣、`…` → `..`、
 * en dash → `-`、连字 → 多字符、U+FFFD 剔除），用 name 取字符会错位或 undefined。
 * 越界（例如归一化规则变更前的历史记录）时回退 `?`，不抛错。
 */
export function getMistakeChar(displayWord: string, index: number): string {
  if (!Number.isFinite(index) || index < 0 || index >= displayWord.length) return '?'
  return displayWord[index]
}
