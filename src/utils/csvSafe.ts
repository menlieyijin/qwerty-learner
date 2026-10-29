/**
 * CSV 公式注入防护（v9.19，dsh，审计 F5-001）。
 *
 * 背景：错题本导出的 `.csv` 由 SheetJS 生成纯文本，单元格内容不做任何转义。
 * 如果某个词的释义/单词以 `= + - @`（或 Tab / CR）开头，Excel / WPS / Numbers 打开时会把该单元格
 * 当作**公式**求值（CSV injection）：`=HYPERLINK(...)`、`=cmd|' /c calc'!A0` 这类载荷在用户双击
 * 打开导出文件时执行。词库来自第三方、也可由用户导入，属于不可信输入。
 *
 * 处理：只对「会被表格软件当作公式」的单元格做前缀 `'`（Excel 里 `'` 是文本标记，不显示，值不变）。
 * 纯函数、无依赖，便于单独断言（见 scripts/verify-csv-safe.mjs）。
 */

/** 会被 Excel/WPS 当作公式起始的字符：= + - @ ，以及 Tab(0x09)/CR(0x0d) 这类可被用来绕过的控制字符 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/

/**
 * 把单元格值转成安全的 CSV 文本。
 *
 * - 非字符串（数字、null、undefined）原样返回：`错误次数` 是数字列，加引号会变成文本、影响排序；
 * - 字符串以公式字符开头 → 前缀 `'`；
 * - 其余字符串原样返回（引号与逗号的转义由 SheetJS 负责）。
 */
export function csvSafeCell<T>(value: T): T | string {
  if (typeof value !== 'string') return value
  if (!FORMULA_PREFIX.test(value)) return value
  return `'${value}`
}
