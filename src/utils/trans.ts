/**
 * 释义字段归一化（v10.3，dsh，F5-004）。
 *
 * 背景：词库里的 `trans` 有三种形态——`string[]`、单个 `string`、`null/undefined`，
 * 另外第三方词库里还出现过数组里混入非字符串（数字、对象）的情况。
 * v10.2 时仓库里有 8 处各自实现、语义分三种：
 *
 * | 早期实现 | 数组处理 | 标量 | 空 |
 * | --- | --- | --- | --- |
 * | `learningPath` / `useWordList` / `DropdownExport` | 过滤非字符串 | `[String(v)]` | `[]` |
 * | `Word`（attempt meta）/ `useGetWord` | 不过滤 | `[String(v)]` | `[]` |
 * | `autoLevel` / `sessionRequeue` | 过滤非字符串 | 丢弃 | `[]` |
 * | `memory`（记忆记录读出） | 不过滤 | 丢弃 | `[]` |
 *
 * v10.3 起**全部 8 处统一走这里**，采用最宽松且类型安全的一档：
 * 数组过滤非字符串、标量 `String()`、空 `[]`。统一后以下行为发生变化（均为「更健壮」方向）：
 * - `autoLevel` / `sessionRequeue` / `memory` 现在接受标量 `trans`（原来直接丢弃）；
 * - `Word` / `useGetWord` / `memory` 现在过滤数组里的非字符串（原来原样带着走）。
 * 这些改动由 309 条核心回归（`learningPath`/`autoLevel`/`memory` 在算法路径上）与
 * `test:typing`、`test:pages` 共同把关。
 */
export function normalizeTrans(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (value == null) return []
  return [String(value)]
}
