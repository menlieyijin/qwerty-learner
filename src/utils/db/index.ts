import type { IChapterRecord, IMemoryRecord, IReviewRecord, IRevisionDictRecord, IWordRecord, LetterMistakes } from './record'
import { ChapterRecord, ReviewRecord, WordRecord } from './record'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import type { TypingState } from '@/pages/Typing/store/type'
import { currentChapterAtom, currentDictIdAtom, isReviewModeAtom } from '@/store'
import { MEMORY_GRADUATE_STAGE, adaptiveDaysFromRecord, clampStage, ladderDays } from '@/utils/memoryLadder'
import { removeMemoryCache, upsertMemoryCache } from '@/utils/memoryCache'
import { memoryKey } from '@/utils/memoryKey'
import { computeDue, evaluateWrong, shouldCountSlow } from '@/utils/srsRules'
import { removeFromRequeue, pushWrongWordRequeue } from '@/utils/sessionRequeue'
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

/** v7：根据一次作答更新记忆曲线记录（在背单词完成后调用）；v9.3 接入 srsRules 并显式传递 refresh */
export async function updateMemoryProgress(
  dict: string,
  word: string,
  wrongCount: number,
  totalMs = 0,
  trans?: string[],
  phone?: string,
  isRefreshRequested = false,
): Promise<void> {
  try {
    const key = memoryKey(dict, word)
    const now = Date.now()
    const prev = await db.memoryRecords.get(key)
    const isNew = !prev
    const prevDue = Number(prev?.due) || 0
    const prevLastSeen = Number(prev?.lastSeen) || 0
    const clockRollback = !!prev && now < prevLastSeen
    // 只有新词 / 已到期词（含时钟回拨）才升档；同会话循环/回看只记 early-ok
    const wasDue = isNew || clockRollback || prevDue <= now
    // v9.3：refresh 只在“未到期”时生效；到期词即使带着旧 refresh 标记也按正常复习升档
    const isRefresh = !!isRefreshRequested && !wasDue && !isNew
    const ok = Number(wrongCount) === 0
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
    // 时钟回拨：把未来 due 校正到 now，否则会永远 early-ok（P1-4）
    if (clockRollback && prev) rec.due = now
    // 慢词统计与作答分支无关（refresh-ok 也计数，P2-9）
    if (shouldCountSlow(totalMs)) rec.slow += 1

    const finalize = async () => {
      // v8.3 影子调度：只记录自适应估算，不改变 due
      rec.shadowInterval = adaptiveDaysFromRecord(rec)
      rec.shadowDue = now + Math.round(rec.shadowInterval * 24 * 3600 * 1000)
      rec.shadowAt = now
      await db.memoryRecords.put(rec)
      upsertMemoryCache(rec)
      // v9.3：完成一次作答后清掉 Skip/suspended；持续遗忘（lapses>=4）自动挂起为“待攻克”
      // 动态 import autoLevel，避免 db → autoLevel → learningPath 在应用启动阶段形成 TDZ 循环
      try {
        const { clearSkip, suspendWord } = await import('@/utils/autoLevel')
        clearSkip(dict, word)
        if (!ok && rec.lapses >= 4) suspendWord(dict, word)
      } catch { /* ignore */ }
    }

    if (isRefresh) {
      // 随机回顾：答对只刷新记忆，不延长间隔；答错按分级降档处理
      if (ok) {
        rec.correct += 1
        rec.lastResult = 'refresh-ok'
      } else {
        const w = evaluateWrong(prev, wrongCount)
        rec.wrong += 1
        rec.stage = w.stage
        rec.ease = w.ease
        rec.lapses += w.lapseDelta
        rec.interval = ladderDays(rec.stage)
        rec.due = computeDue(now, rec.interval)
        rec.lastResult = 'refresh-wrong'
      }
      await finalize()
      return
    }

    if (ok) {
      rec.correct += 1
      if (wasDue) {
        rec.stage = isNew ? MEMORY_GRADUATE_STAGE : clampStage(rec.stage + 1)
        rec.ease = Math.min(3, Math.round((rec.ease + 0.1) * 100) / 100)
        rec.interval = ladderDays(rec.stage)
        rec.due = computeDue(now, rec.interval)
        rec.lastResult = 'ok'
      } else {
        // 同会话提前重练：只刷新记忆，不推进档位、不延长到期时间
        rec.lastResult = 'early-ok'
      }
    } else {
      const w = evaluateWrong(prev, wrongCount)
      rec.wrong += 1
      rec.stage = w.stage
      rec.ease = w.ease
      rec.lapses += w.lapseDelta
      rec.interval = ladderDays(rec.stage)
      rec.due = computeDue(now, rec.interval)
      rec.lastResult = 'wrong'
    }
    await finalize()
  } catch (e) {
    console.error('update memory progress failed', e)
  }
}

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

export function useDeleteWordRecord() {
  const deleteWordRecord = useCallback(async (word: string, dict: string) => {
    try {
      const deletedCount = await db.wordRecords.where({ word, dict }).delete()
      // v8.9：错词本删词时同步删记忆曲线记录，否则删掉的词仍按曲线出现、累计已学不减
      try {
        const key = memoryKey(dict, word)
        await db.memoryRecords.delete(key)
        removeMemoryCache(key)
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

/** v9.3：复习模式跳过时把该词的 due 顺延（至少 N 天），避免立刻再次出现 */
export async function deferMemoryDue(dict: string, word: string, days = 1): Promise<void> {
  try {
    const key = memoryKey(dict, word)
    const rec = await db.memoryRecords.get(key)
    if (!rec) return
    const now = Date.now()
    rec.due = Math.max(Number(rec.due) || 0, computeDue(now, Math.max(0.0208, days)))
    await db.memoryRecords.put(rec)
    upsertMemoryCache(rec)
  } catch (e) {
    console.error('defer memory due failed', e)
  }
}
