import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import type { TypingState } from '@/pages/Typing/store/type'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom } from '@/store'
import { db, updateMemoryProgress } from '@/utils/db'
import type { LetterMistakes } from '@/utils/db/record'
import { ChapterRecord, WordRecord } from '@/utils/db/record'
import { pushWrongWordRequeue } from '@/utils/sessionRequeue'
import { useAtomValue } from 'jotai'
import { useCallback, useContext } from 'react'

// v9.12（dsh，M6-002）：这两个「写库 hook」从 `@/utils/db` 迁出。
// 原因：它们读全局 atom、吃 pages 的 TypingState 并 dispatch，属打字页职责；
// 留在数据层会让 `utils/db` 反向依赖 `pages/Typing/store`（value 边），
// 既形成 7 文件循环依赖，也让数据层无法在无 React 环境复用（仿真需 stub）。
// 逻辑与原实现逐行一致，唯一变化是文件位置与 import 路径。

export function useSaveChapterRecord() {
  const currentChapter = useAtomValue(currentChapterAtom)
  const isRevision = useAtomValue(isReviewModeAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const saveChapterRecord = useCallback(
    async (typingState: TypingState, recordId?: number): Promise<number | undefined> => {
      const {
        chapterData: { correctCount, wrongCount, userInputLogs, wordCount, words, wordRecordIds },
        timerData: { time },
      } = typingState
      const correctWordIndexes = userInputLogs.filter((log) => log.correctCount > 0 && log.wrongCount === 0).map((log) => log.index)

      const chapterRecord = new ChapterRecord(
        dictID,
        isRevision ? -1 : currentChapter,
        time,
        correctCount,
        wrongCount,
        wordCount,
        correctWordIndexes,
        words.length,
        wordRecordIds ?? [],
      )
      // v9.3：暂停保存改为“会话 upsert”，避免多次暂停把累计值重复相加
      if (recordId) {
        await db.chapterRecords.update(recordId, chapterRecord)
        return recordId
      }
      return db.chapterRecords.add(chapterRecord)
    },
    [currentChapter, dictID, isRevision],
  )

  return saveChapterRecord
}

export function useSaveWordRecord() {
  const isRevision = useAtomValue(isReviewModeAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const { dispatch } = useContext(TypingContext) ?? {}

  const saveWordRecord = useCallback(
    async ({
      word,
      dict,
      trans,
      phone,
      wrongCount,
      letterTimeArray,
      letterMistake,
      isRefresh,
    }: {
      word: string
      dict?: string
      trans?: string[]
      phone?: string
      wrongCount: number
      letterTimeArray: number[]
      letterMistake: LetterMistakes
      /** v9.3：本次作答来自随机回顾/错词重练（显式传递，不依赖全局标记） */
      isRefresh?: boolean
    }) => {
      const timing = []
      for (let i = 1; i < letterTimeArray.length; i++) {
        const diff = letterTimeArray[i] - letterTimeArray[i - 1]
        timing.push(diff)
      }

      const recordDict = dict || dictID
      const wordRecord = new WordRecord(word, recordDict, isRevision ? -1 : currentChapter, timing, wrongCount, letterMistake)

      let dbID = -1
      try {
        dbID = await db.wordRecords.add(wordRecord)
      } catch (e) {
        console.error(e)
      }
      // v7：写入/更新记忆曲线记录（按艾宾浩斯阶梯安排下一次复习）
      const totalMs = timing.reduce((acc, cur) => acc + cur, 0)
      try {
        await updateMemoryProgress(recordDict, word, wrongCount, totalMs, trans, phone, !!isRefresh)
      } catch (e) {
        console.error('save memory progress failed', e)
      }
      // v8 错词当场重现：本次会话内隔几个词再练一次（不影响 memoryRecords 的 10 分钟档）
      if (Number(wrongCount) > 0) {
        try {
          pushWrongWordRequeue(recordDict, word, trans, phone)
        } catch (e) {
          console.error('push requeue failed', e)
        }
      }
      if (dispatch) {
        dbID > 0 && dispatch({ type: TypingStateActionType.ADD_WORD_RECORD_ID, payload: dbID })
        dispatch({ type: TypingStateActionType.SET_IS_SAVING_RECORD, payload: false })
      }
    },
    [currentChapter, dictID, dispatch, isRevision],
  )

  return saveWordRecord
}
