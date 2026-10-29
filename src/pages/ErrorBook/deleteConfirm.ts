import { idDictionaryMap } from '@/resources/dictionary'
import { db } from '@/utils/db'
import { memoryKey } from '@/utils/memoryKey'

/** 词典显示名（自定义词库不在 idDictionaryMap 里，回退显示命名空间） */
export function dictDisplayName(dict: string): string {
  const info = idDictionaryMap[dict]
  if (info?.name) return info.name
  if (dict.startsWith('custom:')) return `自定义词库「${dict.slice('custom:'.length)}」`
  return dict || '未知词典'
}

/**
 * 删除前的影响预览（只读统计，不写库）。
 *
 * 删除会同时移除该词在该词典下的全部 wordRecords 与对应 memoryRecord，
 * 因此这里明确列出条数与其他词典是否还有同词记录，避免误删不可恢复。
 */
export async function buildDeleteConfirmText(word: string, dict: string): Promise<string> {
  let recordCount = 0
  let hasMemoryRecord = false
  let otherDicts: string[] = []
  let statsOk = true
  try {
    const [count, memoryRecord, sameWordRecords] = await Promise.all([
      db.wordRecords.where({ word, dict }).count(),
      db.memoryRecords.get(memoryKey(dict, word)),
      db.wordRecords.where('word').equals(word).toArray(),
    ])
    recordCount = count
    hasMemoryRecord = !!memoryRecord
    otherDicts = Array.from(new Set(sameWordRecords.map((record) => record.dict))).filter((item) => item !== dict)
  } catch (error) {
    // 统计失败不阻断删除流程，但不再展示条数，避免误导
    statsOk = false
    console.error('统计待删除记录失败：', error)
  }
  const lines = [
    `确认从错题本删除「${word}」？`,
    '',
    `词典：${dictDisplayName(dict)}`,
    statsOk
      ? `将删除 ${recordCount} 条练习记录（含答对记录）${hasMemoryRecord ? ' + 1 条记忆曲线记录' : '（未找到记忆曲线记录）'}`
      : '无法读取待删除记录数：仍会删除该词在该词典下的全部练习记录与记忆曲线记录',
    '删除后该词的复习进度会丢失，并重新进入新词池；累计/今日/到期统计会同步减少，此操作不可恢复。',
  ]
  if (otherDicts.length > 0) {
    lines.push(`注意：该单词在以下词典也有错题记录，本次只删除「${dictDisplayName(dict)}」：${otherDicts.map(dictDisplayName).join('、')}`)
  }
  return lines.join('\n')
}
