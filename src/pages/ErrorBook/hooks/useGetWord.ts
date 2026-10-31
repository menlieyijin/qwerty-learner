import type { Dictionary, Word } from '@/typings'
import { db } from '@/utils/db'
import { memoryKey } from '@/utils/memoryKey'
import { normalizeTrans } from '@/utils/trans'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

type MemoryWordState = {
  key: string
  word: Word
}

/**
 * 取单词释义：优先官方词库；词库不存在（如 custom: 自定义词库）或词条不在词库时，
 * v9.0 回退到记忆曲线记录里的 trans（练习/导入时已存），避免官方错题本只显示单词没有释义。
 *
 * L-10：回退结果必须与当前 (name, dictId) 绑定。旧实现直接 setMemoryWord，切换行/翻页时
 * 新一行会先用上一行的释义渲染一帧再被异步结果替换（闪旧释义），这里用 key 匹配消除闪烁。
 */
export default function useGetWord(name: string, dict: Dictionary | undefined, dictId: string) {
  const { data: wordList, error, isLoading } = useSWR(dict?.url, wordListFetcher)
  const [memoryWord, setMemoryWord] = useState<MemoryWordState | undefined>(undefined)

  const currentMemoryKey = useMemo(() => memoryKey(dictId, name), [dictId, name])

  const word = useMemo<Word | undefined>(() => {
    if (wordList) {
      const found = wordList.find((item) => item.name === name)
      if (found) {
        const trans = normalizeTrans(found.trans)
        return { ...found, trans }
      }
    }
    // 只接受与当前行匹配的回退结果，避免页面上出现“上一行的释义”
    return memoryWord?.key === currentMemoryKey ? memoryWord.word : undefined
  }, [wordList, name, currentMemoryKey, memoryWord])

  useEffect(() => {
    if (word) return
    let cancelled = false
    db.memoryRecords
      .get(currentMemoryKey)
      .then((record) => {
        if (cancelled || !record || !record.trans || record.trans.length === 0) return
        setMemoryWord({
          key: currentMemoryKey,
          word: {
            name: record.word,
            trans: record.trans,
            usphone: record.phone || '',
            ukphone: record.phone || '',
            ...(record.dict ? { dict: record.dict } : {}),
          },
        })
      })
      .catch(() => {
        /* 回退查询失败时保持无释义状态，不阻断页面 */
      })
    return () => {
      cancelled = true
    }
  }, [currentMemoryKey, word])

  const hasError = !!error || (!!wordList && !word && !isLoading)
  return { word, isLoading, hasError }
}
