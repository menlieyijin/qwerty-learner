import type { groupedWordRecords } from './type'
import { idDictionaryMap } from '@/resources/dictionary'
import { currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Word } from '@/typings'
import { ReviewRecord } from '@/utils/db/record'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * v7：保留官方「错题回顾」功能，入口移到错题本（不再依赖词典章节弹窗）。
 * 接收当前分组记录，返回启动回顾练习的回调。
 */
export function useWrongReview(groupedRecords: groupedWordRecords[]) {
  const navigate = useNavigate()
  const currentDictId = useAtomValue(currentDictIdAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)

  const startWrongReview = useCallback(async () => {
    const dict = idDictionaryMap[currentDictId] ?? idDictionaryMap.cet4
    const groups = groupedRecords.filter((g) => g.dict === dict.id)
    if (!groups.length) {
      alert('当前词典还没有错题')
      return
    }
    let list: Word[] = []
    try {
      list = await wordListFetcher(dict.url)
    } catch {
      alert('词库读取失败')
      return
    }
    // v9.14（dsh，M4-012/M4-017）：list.find（O(n·m)）改为按词名建 Map，并用类型守卫取代 `as Word[]`。
    // 部分词库存在同名词条，这里保留「首次出现」（与原先 list.find 取第一条的语义一致）。
    const wordsByName = new Map<string, Word>()
    for (const word of list) {
      if (!wordsByName.has(word.name)) wordsByName.set(word.name, word)
    }
    const words = groups.map((g) => wordsByName.get(g.word)).filter((word): word is Word => !!word)
    if (!words.length) {
      alert('没有可复习的错题')
      return
    }
    setReviewModeInfo({ isReviewMode: true, reviewRecord: new ReviewRecord(dict.id, words) })
    navigate('/')
  }, [currentDictId, groupedRecords, navigate, setReviewModeInfo])

  return startWrongReview
}
