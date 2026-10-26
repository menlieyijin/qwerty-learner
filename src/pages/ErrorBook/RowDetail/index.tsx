/* eslint-disable react/prop-types */
import { LoadingWordUI } from '../LoadingWordUI'
import useGetWord from '../hooks/useGetWord'
import { currentRowDetailAtom } from '../store'
import type { groupedWordRecords } from '../type'
import DataTag from './DataTag'
import RowPagination from './RowPagination'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { WordPronunciationIcon } from '@/components/WordPronunciationIcon'
import Phonetic from '@/pages/Typing/components/WordPanel/components/Phonetic'
import Letter from '@/pages/Typing/components/WordPanel/components/Word/Letter'
import { idDictionaryMap } from '@/resources/dictionary'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import HashtagIcon from '~icons/heroicons/chart-pie-20-solid'
import CheckCircle from '~icons/heroicons/check-circle-20-solid'
import ClockIcon from '~icons/heroicons/clock-20-solid'
import XCircle from '~icons/heroicons/x-circle-20-solid'
import IconX from '~icons/tabler/x'

type RowDetailProps = {
  currentRowDetail: groupedWordRecords
  allRecords: groupedWordRecords[]
}

/**
 * DATA-006：错题详情的统计口径（此前标签与数值错位）：
 * - 平均用时 = 该词所有练习记录的 totalTime 平均值（单位：秒，保留 2 位小数）；无记录时该字段无意义，UI 隐藏；
 * - 练习次数 = 该词产生的练习记录条数（每条记录 = 一次完整作答/一次错题回顾中的一次练习）；
 * - 答对次数 = 其中 wrongCount === 0 的记录条数（该次练习零错键完成）；
 * - 错键次数 = 所有记录 wrongCount 之和（按错键的次数，不是错词数、不是练习次数）。
 * 旧实现把「练习次数」显示成 records.length + wrongCount（把错键次数当练习次数）、
 * 把「正确次数」显示成 records.length（实际是练习次数）、「错误次数」用聚合 wrongCount 也没说清是错键次数。
 */
export type RowDetailData = {
  hasRecords: boolean
  /** 平均用时（秒，2 位小数字符串；无记录时为占位符，UI 会隐藏该字段） */
  averageSeconds: string
  /** 练习次数 = 记录条数 */
  exerciseCount: number
  /** 答对次数 = wrongCount === 0 的记录条数 */
  correctCount: number
  /** 错键次数 = 所有记录 wrongCount 之和 */
  wrongKeyCount: number
}

type RowDetailRecordLike = {
  totalTime?: number
  wrongCount?: number
}

/** 容错：缺失/NaN/负数等脏数据一律按 0 计，避免统计里出现 NaN；同时保证“答对”判定与“错键次数”口径一致 */
function toSafeCount(value: number | undefined): number {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? count : 0
}

export function computeRowDetailStats(records: readonly RowDetailRecordLike[]): RowDetailData {
  const exerciseCount = records.length
  if (exerciseCount === 0) {
    // 没有任何记录时平均值无意义 → averageSeconds 用占位符且 UI 不渲染「平均用时」标签
    return { hasRecords: false, averageSeconds: '—', exerciseCount: 0, correctCount: 0, wrongKeyCount: 0 }
  }

  const totalTime = records.reduce((sum, record) => sum + (Number(record.totalTime) || 0), 0)
  const averageSeconds = (totalTime / exerciseCount / 1000).toFixed(2)
  const wrongKeyCounts = records.map((record) => toSafeCount(record.wrongCount))
  const correctCount = wrongKeyCounts.filter((wrongCount) => wrongCount === 0).length
  const wrongKeyCount = wrongKeyCounts.reduce((sum, wrongCount) => sum + wrongCount, 0)

  return { hasRecords: true, averageSeconds, exerciseCount, correctCount, wrongKeyCount }
}

const RowDetail: React.FC<RowDetailProps> = ({ currentRowDetail, allRecords }) => {
  const setCurrentRowDetail = useSetAtom(currentRowDetailAtom)

  const dictInfo = idDictionaryMap[currentRowDetail.dict]
  const { word, isLoading, hasError } = useGetWord(currentRowDetail.word, dictInfo, currentRowDetail.dict)
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)

  const rowDetailData = useMemo(() => computeRowDetailStats(currentRowDetail.records), [currentRowDetail.records])

  const onClose = useCallback(() => {
    setCurrentRowDetail(null)
  }, [setCurrentRowDetail])

  useHotkeys(
    'esc',
    (e) => {
      onClose()
      e.stopPropagation()
    },
    { preventDefault: true },
  )

  useHotkeys(
    'ctrl+j',
    () => {
      wordPronunciationIconRef.current?.play()
    },
    [],
    { enableOnFormTags: true, preventDefault: true },
  )

  return (
    <div className="absolute inset-0 flex  flex-col items-center  justify-center ">
      <div className="my-card relative z-10 flex h-[32rem] min-w-[26rem] select-text flex-col items-center justify-around rounded-2xl bg-white px-3 py-10 dark:bg-gray-900">
        <IconX className="absolute right-3 top-3  h-6 w-6 cursor-pointer text-gray-400" onClick={onClose} />
        <div className="flex flex-col items-center justify-start">
          <div>
            {currentRowDetail.word.split('').map((t, index) => (
              <Letter key={`${index}-${t}`} letter={t} visible state="normal" />
            ))}
          </div>
          <div className="relative flex h-8 items-center">
            {word ? <Phonetic word={word} /> : <LoadingWordUI isLoading={isLoading} hasError={hasError} />}
            {word && (
              <WordPronunciationIcon
                // PAGES-001：dictInfo 可能为 undefined（custom:<name> 自定义词库 / 词典已下架），
                // 未判空会在渲染期抛 TypeError；应用现在有 ErrorBoundary 兜底，但这里仍按最小修复判空。
                lang={dictInfo?.language ?? 'en'}
                word={word}
                className="absolute -right-7 top-1/2 h-5 w-5 -translate-y-1/2 transform "
                ref={wordPronunciationIconRef}
              />
            )}
          </div>
          <div className="flex max-w-[24rem] items-center">
            <span className={`max-w-4xl text-center font-sans transition-colors duration-300 dark:text-white dark:text-opacity-80`}>
              {word ? word.trans.join('；') : <LoadingWordUI isLoading={isLoading} hasError={hasError} />}
            </span>
          </div>
        </div>
        <div className="item flex flex-col gap-4">
          <div className="flex gap-6">
            {rowDetailData.hasRecords && <DataTag icon={ClockIcon} name="平均用时" data={`${rowDetailData.averageSeconds}s`} />}
            <DataTag icon={HashtagIcon} name="练习次数" data={rowDetailData.exerciseCount} />
          </div>
          <div className="flex gap-6">
            <DataTag icon={CheckCircle} name="答对次数" data={rowDetailData.correctCount} />
            <DataTag icon={XCircle} name="错键次数" data={rowDetailData.wrongKeyCount} />
          </div>
        </div>
        <RowPagination className="absolute bottom-6 mt-10" allRecords={allRecords} />
      </div>
      <div className="absolute inset-0 z-0  cursor-pointer bg-transparent" onClick={onClose}></div>
    </div>
  )
}

export default RowDetail
