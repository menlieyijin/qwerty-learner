import type { Dictionary, Word } from '@/typings'
import { db } from '@/utils/db'
import { memoryKey } from '@/utils/memoryKey'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

/**
 * 取单词释义：优先官方词库；词库不存在（如 custom: 自定义词库）或词条不在词库时，
 * v9.0 回退到记忆曲线记录里的 trans（练习/导入时已存），避免官方错题本只显示单词没有释义。
 */
export default function useGetWord(name: string, dict: Dictionary | undefined, dictId: string) {
  const { data: wordList, error, isLoading } = useSWR(dict?.url, wordListFetcher)
  const [memoryWord, setMemoryWord] = useState<Word | undefined>(undefined)

  const word = useMemo<Word | undefined>(() => {
    if (wordList) {
      const found = wordList.find((item) => item.name === name)
      if (found) {
        const trans = Array.isArray(found.trans) ? found.trans : found.trans ? [String(found.trans)] : []
        return { ...found, trans }
      }
    }
    return memoryWord
  }, [wordList, name, memoryWord])

  useEffect(() => {
    if (word) return
    let cancelled = false
    db.memoryRecords
      .get(memoryKey(dictId, name))
      .then((record) => {
        if (cancelled || !record || !record.trans || record.trans.length === 0) return
        setMemoryWord({
          name: record.word,
          trans: record.trans,
          usphone: record.phone || '',
          ukphone: record.phone || '',
          ...(record.dict ? { dict: record.dict } : {}),
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [name, dictId, word])

  const hasError = !!error || (!!wordList && !word && !isLoading)
  return { word, isLoading, hasError }
}
