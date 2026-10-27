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
 * v9.10（TYP-013，dsh）：分隔符在**判定期**互相等价。
 *
 * 背景（用户实测）：词条 `t-shirt` 必须打 `-`、`a/an` 必须打 `/`，用户习惯打空格 → 同一位置被判错；
 * 反向也有：词条本身是空格（`ice cream`）时用户打 `-`/`/` 同样应通过。
 *
 * 为什么放在「比较期」而不改 normalizeDisplayWord：
 * 归一化只影响展示，把 `/` 归一成 `␣` 会让 `a/an` 显示成 `a␣an`（语义错），
 * 而且会改变 displayWord 的字符内容，污染 letterMistake 记下的 expected 字符与结果页导出。
 * 这里只放宽「字符是否算相同」，长度与下标保持 1:1（`t shirt` 与 `t-shirt` 同为 7 位）。
 *
 * 等价类只含：普通空格、EXPLICIT_SPACE（归一化后的空格）、`-`、`/`。
 * 为什么**不含** `_` `.` `'` `&`：
 * - `_` 只出现在程序类词库（languageCategory=code），而 code 语义下 `_` 是标识符的一部分，不与空格等价；
 * - `.` 是句读/缩写标记（`a.m.`、`U.S.`），若与空格等价，`a.m.` 打 `a m` 就会误判为正确；
 * - `'` 是词内撇号（`don't`、`it's`），与空格不等价，否则 `dont` 这类漏撇号输入会被放过；
 * - `&` 是实义符号（`AT&T`、`R&D`），保留严格匹配。
 */
export const SEPARATOR_CLASS: Set<string> = new Set([' ', EXPLICIT_SPACE, '-', '/'])

export function isSeparatorChar(ch: string): boolean {
  return SEPARATOR_CLASS.has(ch)
}

/**
 * 单字符比较（判定期唯一入口）。
 *
 * 顺序很关键：分隔符等价必须在 toLowerCase **之前**独立判断，
 * 否则 isIgnoreCase=false 时会走到 `return false` 分支，等价被吞掉。
 */
export function charsMatch(input: string, expected: string, isIgnoreCase: boolean): boolean {
  if (input === expected) return true
  if (isSeparatorChar(input) && isSeparatorChar(expected)) return true
  return isIgnoreCase ? input.toLowerCase() === expected.toLowerCase() : false
}

/**
 * 分隔符等价是否生效：仅英/德文等拉丁词库，且不含程序类词库。
 * - romaji / hapin：`-` 是长音符（`taima-`），`/` 有特殊含义，不能放宽；
 * - languageCategory=code（含 language='en' 的 OI_XCPC 等）：`-` `_` `/` 是语法字符，语义不同。
 */
export function isSeparatorEquivalenceEnabled(language: string, languageCategory?: string): boolean {
  if (languageCategory === 'code') return false
  return language === 'en' || language === 'de'
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
