/**
 * 释义字段归一化（v10.2，dsh，F5-004）。
 *
 * 背景：词库里的 `trans` 有三种形态——`string[]`、单个 `string`、`null/undefined`，
 * 另外第三方词库里还出现过数组里混入非字符串（数字、对象）的情况。仓库里原先有 8 处各自实现，
 * 语义并不一致（见下表），其中 3 处完全相同，这里先合并这 3 处。
 *
 * | 位置 | 数组处理 | 标量 | 空 |
 * | --- | --- | --- | --- |
 * | `utils/learningPath.ts` | 过滤非字符串 | `[String(v)]` | `[]` |
 * | `pages/Typing/hooks/useWordList.ts` | 过滤非字符串 | `[String(v)]` | `[]` |
 * | `pages/ErrorBook/DropdownExport.tsx` | 过滤非字符串 | `[String(v)]` | `[]` |
 * | `pages/Typing/components/.../Word/index.tsx` | **不过滤** | `[String(v)]` | `[]` |
 * | `utils/autoLevel.ts` | 过滤非字符串 | **不回退（丢弃）** | `[]` |
 * | `utils/memory.ts` | **不过滤** | **丢弃** | `[]` |
 * | `utils/sessionRequeue.ts` | 过滤非字符串 | **丢弃** | `[]` |
 * | `pages/ErrorBook/hooks/useGetWord.ts` | **不过滤** | `[String(v)]` | `[]` |
 *
 * 只有前三行语义一致，本次统一到这里；其余 5 处**保持原样**（它们分别处在记忆曲线写入、
 * 记忆记录读出、重练队列与错题详情路径上，改变「丢弃 / 不过滤」的语义会影响数据形态，
 * 需要单独评估，已记入遗留清单）。
 */
export function normalizeTrans(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (value == null) return []
  return [String(value)]
}
