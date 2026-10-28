import { db, deleteMemoryRecordForWord } from '@/utils/db'
import { removeFromRequeue } from '@/utils/sessionRequeue'
import { useCallback } from 'react'

// v9.12（dsh，M6-002）：本文件原本还承载 useSaveChapterRecord / useSaveWordRecord，
// 那两个 hook 需要 TypingContext 与 TypingState，属打字页职责，已迁至
// `@/pages/Typing/hooks/useSaveRecord`；这里只留不依赖任何页面上下文的删词 hook，
// 使 `@/utils/db` 彻底摆脱对 pages 的反向依赖（数据层可在非 React 环境复用）。
// 迁出的两个 hook 与原实现逐行一致。

export function useDeleteWordRecord() {
  const deleteWordRecord = useCallback(async (word: string, dict: string) => {
    try {
      const deletedCount = await db.wordRecords.where({ word, dict }).delete()
      // v8.9：错词本删词时同步删记忆曲线记录，否则删掉的词仍按曲线出现、累计已学不减
      try {
        // v9.5（DATA-003）：新旧 key 都删，但只在记录的 word 与待删单词大小写一致时才删，
        // 避免误删「同名不同大小写」的兄弟词条（如删 March 时删掉 march 的记录）。
        await deleteMemoryRecordForWord(dict, word)
        removeFromRequeue(dict, word)
        const { clearSkip } = await import('@/utils/autoLevel')
        clearSkip(dict, word)
      } catch (e) {
        console.error('删除记忆曲线记录失败：', e)
      }
      return deletedCount
    } catch (error) {
      console.error(`删除单词记录时出错：`, error)
    }
  }, [])

  return { deleteWordRecord }
}
