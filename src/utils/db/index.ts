import type { IChapterRecord, IMemoryRecord, IReviewRecord, IRevisionDictRecord, IWordRecord, LetterMistakes } from './record'
import { ChapterRecord, ReviewRecord, WordRecord } from './record'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import type { TypingState } from '@/pages/Typing/store/type'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom } from '@/store'
import { MEMORY_GRADUATE_STAGE, MEMORY_SLOW_MS, adaptiveDaysFromRecord, clampStage, ladderDays } from '@/utils/memoryLadder'
import { removeMemoryCache, upsertMemoryCache } from '@/utils/memoryCache'
import { memoryKey } from '@/utils/memoryKey'
import { consumeRefresh } from '@/utils/refreshMarker'
import { pushWrongWordRequeue } from '@/utils/sessionRequeue'
import type { Table } from 'dexie'
import Dexie from 'dexie'
import { useAtomValue } from 'jotai'
import { useCallback, useContext } from 'react'

class RecordDB extends Dexie {
  wordRecords!: Table<IWordRecord, number>
  chapterRecords!: Table<IChapterRecord, number>
  reviewRecords!: Table<IReviewRecord, number>
  memoryRecords!: Table<IMemoryRecord, string>

  revisionDictRecords!: Table<IRevisionDictRecord, number>
  revisionWordRecords!: Table<IWordRecord, number>

  constructor() {
    super('RecordDB')
    this.version(1).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,errorCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(2).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(3).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
    })
    // v7：记忆曲线记录（Dexie 内部版本号会映射为 IDB 40；升级保留旧数据）
    this.version(4).stores({
      memoryRecords: 'key,word,dict,due,[dict+due]',
    })
  }
}

export const db = new RecordDB()

db.wordRecords.mapToClass(WordRecord)
db.chapterRecords.mapToClass(ChapterRecord)
db.reviewRecords.mapToClass(ReviewRecord)

/** v7：根据一次作答更新记忆曲线记录（在背单词完成后调用） */
export async function updateMemoryProgress(
  dict: string,
  word: string,
  wrongCount: number,
  totalMs = 0,
  trans?: string[],
  phone?: string,
): Promise<void> {
  try {
    const key = memoryKey(dict, word)
    const now = Date.now()
    const prev = await db.memoryRecords.get(key)
    const isNew = !prev
    // v8.9：只有新词 / 已到期的词答对才推进档位；同会话循环重练、回看上一词、Restart 重放不升档
    const wasDue = isNew || (Number(prev?.due) || 0) <= now
    const ok = Number(wrongCount) === 0
    const isRefresh = consumeRefresh(key)
    const rec: IMemoryRecord = prev
      ? { ...prev }
      : {
          key,
          word,
          dict,
          trans: trans || [],
          phone: phone || '',
          stage: 0,
          interval: 0,
          ease: 2.5,
          due: 0,
          lastSeen: 0,
          createdAt: now,
          attempts: 0,
          correct: 0,
          wrong: 0,
          slow: 0,
          lapses: 0,
          lastResult: '',
        }
    rec.word = word
    rec.dict = dict
    if (trans && trans.length) rec.trans = trans
    if (phone) rec.phone = phone
    rec.attempts += 1
    rec.lastSeen = now
    if (isRefresh) {
      // 随机回顾：答对只刷新记忆，不延长间隔；答错按正常答错处理
      if (ok) {
        rec.correct += 1
        rec.lastResult = 'refresh-ok'
      } else {
        rec.wrong += 1
        rec.lapses += 1
        rec.stage = 0
        rec.ease = Math.max(1.3, Math.round((rec.ease - 0.2) * 100) / 100)
        rec.interval = ladderDays(0)
        rec.due = now + rec.interval * 24 * 3600 * 1000
        rec.lastResult = 'refresh-wrong'
        if (totalMs > MEMORY_SLOW_MS) rec.slow += 1
      }
      // v8.3 影子调度：只记录自适应估算，不改变 due
      rec.shadowInterval = adaptiveDaysFromRecord(rec)
      rec.shadowDue = now + Math.round(rec.shadowInterval * 24 * 3600 * 1000)
      rec.shadowAt = now
      await db.memoryRecords.put(rec)
      upsertMemoryCache(rec)
      return
    }
    if (ok) {
      rec.correct += 1
      if (wasDue) {
        rec.stage = isNew ? MEMORY_GRADUATE_STAGE : clampStage(rec.stage + 1)
        rec.ease = Math.min(3, Math.round((rec.ease + 0.1) * 100) / 100)
        rec.interval = ladderDays(rec.stage)
        rec.due = now + rec.interval * 24 * 3600 * 1000
        rec.lastResult = 'ok'
      } else {
        // 同会话提前重练：只刷新记忆，不推进档位、不延长到期时间
        rec.lastResult = 'early-ok'
      }
    } else {
      rec.wrong += 1
      rec.lapses += 1
      rec.stage = 0
      rec.ease = Math.max(1.3, Math.round((rec.ease - 0.2) * 100) / 100)
      rec.interval = ladderDays(rec.stage)
      rec.due = now + rec.interval * 24 * 3600 * 1000
      rec.lastResult = 'wrong'
    }
    if (totalMs > MEMORY_SLOW_MS) rec.slow += 1
    // v8.3 影子调度：只记录自适应估算，不改变 due
    rec.shadowInterval = adaptiveDaysFromRecord(rec)
    rec.shadowDue = now + Math.round(rec.shadowInterval * 24 * 3600 * 1000)
    rec.shadowAt = now
    await db.memoryRecords.put(rec)
    upsertMemoryCache(rec)
  } catch (e) {
    console.error('update memory progress failed', e)
  }
}

export function useSaveChapterRecord() {
  const currentChapter = useAtomValue(currentChapterAtom)
  const isRevision = useAtomValue(isReviewModeAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const saveChapterRecord = useCallback(
    (typingState: TypingState) => {
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
      db.chapterRecords.add(chapterRecord)
    },
    [currentChapter, dictID, isRevision],
  )

  return saveChapterRecord
}

export type WordKeyLogger = {
  letterTimeArray: number[]
  letterMistake: LetterMistakes
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
    }: {
      word: string
      dict?: string
      trans?: string[]
      phone?: string
      wrongCount: number
      letterTimeArray: number[]
      letterMistake: LetterMistakes
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
        await updateMemoryProgress(recordDict, word, wrongCount, totalMs, trans, phone)
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

export function useDeleteWordRecord() {
  const deleteWordRecord = useCallback(async (word: string, dict: string) => {
    try {
      const deletedCount = await db.wordRecords.where({ word, dict }).delete()
      // v8.9：错词本删词时同步删记忆曲线记录，否则删掉的词仍按曲线出现、累计已学不减
      try {
        const key = memoryKey(dict, word)
        await db.memoryRecords.delete(key)
        removeMemoryCache(key)
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
