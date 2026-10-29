import DictTagSwitcher from './DictTagSwitcher'
import DictionaryComponent from './DictionaryWithoutCover'
import { currentDictInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { findCommonValues } from '@/utils'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'

type DictionaryGroupProps = {
  groupedDictsByTag: Record<string, Dictionary[]>
  /** v9.14（dsh，M4-011）：由词库页统一算好的「词典 id → 已学词数」；null 表示尚未读到 */
  learnedCounts: Map<string, number> | null
}

export default function DictionaryGroup({ groupedDictsByTag, learnedCounts }: DictionaryGroupProps) {
  const tagList = useMemo(() => Object.keys(groupedDictsByTag), [groupedDictsByTag])
  const [currentTag, setCurrentTag] = useState(tagList.length > 0 ? tagList[0] : '')
  const currentDictInfo = useAtomValue(currentDictInfoAtom)

  const onChangeCurrentTag = useCallback((tag: string) => {
    setCurrentTag(tag)
  }, [])

  useEffect(() => {
    const commonTags = findCommonValues(tagList, currentDictInfo.tags)
    if (commonTags.length > 0) {
      setCurrentTag(commonTags[0])
      return
    }
    // v9.14（dsh，M4-005）：同一分类（如「代码练习」）在多个语言下共用同一个组件实例，切换语言后
    // 旧 tag 可能已不属于新分组的 tagList（如 Code 的 Python → 英语），交集为空时旧 tag 残留，
    // 页面会误报「当前分类下没有可用的词典」。这里在「tagList 变化」时回落到该分类的第一个 tag。
    // 注意用函数式更新且不把 currentTag 放进依赖：否则用户手动点 tag 会让本 effect 重跑，
    // 一旦存在 commonTags 就会被强行弹回（既有交互会被破坏）。
    setCurrentTag((tag) => (tag && tagList.includes(tag) ? tag : tagList[0] ?? ''))
  }, [currentDictInfo.tags, tagList])

  // v9.14（dsh，M4-005）：渲染用的 tag 再做一次校验（state 的重置在 effect 里，晚一帧；
  // 这里兜住切换语言后的那一帧，避免真的闪一下「当前分类下没有可用的词典」）。
  const activeTag = currentTag && groupedDictsByTag[currentTag] ? currentTag : tagList[0] ?? ''

  return (
    <div>
      <DictTagSwitcher tagList={tagList} currentTag={activeTag} onChangeCurrentTag={onChangeCurrentTag} />
      <div className="mt-8 grid gap-x-5 gap-y-10 px-1 pb-4 sm:grid-cols-1 md:grid-cols-2 dic3:grid-cols-3 dic4:grid-cols-4">
        {activeTag && groupedDictsByTag[activeTag] ? (
          groupedDictsByTag[activeTag].map((dict) => (
            // 未读到数据时传 null（隐藏「已学 N」）；读到但没有记录时仍是 0，与旧实现一致
            <DictionaryComponent key={dict.id} dictionary={dict} learnedCount={learnedCounts ? learnedCounts.get(dict.id) ?? 0 : null} />
          ))
        ) : (
          <div className="col-span-full text-center text-gray-500">当前分类下没有可用的词典</div>
        )}
      </div>
    </div>
  )
}
