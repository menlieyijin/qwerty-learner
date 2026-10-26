import { useDeleteWordRecord } from '../../../utils/db'
import { ErrorTable } from '../ErrorTable'
import { getRowsFromErrorWordData } from '../ErrorTable/columns'
import { ReviewDetail } from '../ReviewDetail'
import useErrorWordData from '../hooks/useErrorWords'
import { getDictTotalWordCount, useCanonicalLearnedCount } from '../DictionaryWithoutCover'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { currentChapterAtom, currentDictIdAtom, learningModeAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import { useAtom, useSetAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import IcOutlineCollectionsBookmark from '~icons/ic/outline-collections-bookmark'
import MajesticonsPaperFoldTextLine from '~icons/majesticons/paper-fold-text-line'
import PajamasReviewList from '~icons/pajamas/review-list'

enum Tab {
  Chapters = 'chapters',
  Errors = 'errors',
  Review = 'review',
}

export default function DictDetail({ dictionary: dict }: { dictionary: Dictionary }) {
  // v9.4（dsh）：本组件已不按章节展示，只需 setter；getter 未使用，避免 no-unused-vars 噪音
  const [, setCurrentChapter] = useAtom(currentChapterAtom)
  const [, setCurrentDictId] = useAtom(currentDictIdAtom)
  const setLearningMode = useSetAtom(learningModeAtom)
  const [curTab, setCurTab] = useState<Tab>(Tab.Chapters)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const { deleteWordRecord } = useDeleteWordRecord()
  const [reload, setReload] = useState(false)

  // v9.5（DATA-010）：已学数按 canonical memoryRecords 去重统计（legacy 旧记录不翻倍）
  const learned = useCanonicalLearnedCount(dict.id, true, reload)
  const totalWords = getDictTotalWordCount(dict)

  const { errorWordData, isLoading, error } = useErrorWordData(dict, reload)

  const tableData = useMemo(() => {
    return getRowsFromErrorWordData(errorWordData)
  }, [errorWordData])

  const onDelete = useCallback(
    async (word: string) => {
      await deleteWordRecord(word, dict.id)
      setReload((old) => !old)
    },
    [deleteWordRecord, dict.id],
  )

  // v9.1：改为「用该词库练习」，写入官方 localStorage 状态并回到练习页（不再只设章节）
  const onStartManual = useCallback(() => {
    setLearningMode('manual')
    setCurrentDictId(dict.id)
    setCurrentChapter(0)
    setReviewModeInfo((old) => ({ ...old, isReviewMode: false, reviewRecord: undefined, reviewKind: undefined }))
    navigate('/')
  }, [dict.id, navigate, setCurrentChapter, setCurrentDictId, setLearningMode, setReviewModeInfo])

  const handleTabChange = useCallback(
    (value: Tab) => {
      if (value !== curTab) {
        setCurTab(value)
      }
    },
    [curTab],
  )

  const progress = learned == null ? 0 : Math.min(100, Math.round((learned / Math.max(1, totalWords)) * 100))

  return (
    <div className="flex flex-col rounded-[4rem] px-4 py-3 pl-5 text-gray-800 dark:text-gray-300">
      <div className="text relative flex h-40 flex-col gap-2">
        <h3 className="text-2xl font-semibold">{dict.name}</h3>
        <p className="mt-1">记忆曲线出词 · 无章节</p>
        <p>共 {totalWords} 词</p>
        <p>{dict.description}</p>
        <div className="absolute bottom-5 right-4">
          <ToggleGroup type="single" value={curTab} onValueChange={handleTabChange}>
            <ToggleGroupItem
              value={Tab.Chapters}
              disabled={curTab === Tab.Chapters}
              className={`${curTab === Tab.Chapters ? 'text-primary-foreground bg-primary' : ''} disabled:opacity-100`}
            >
              <MajesticonsPaperFoldTextLine className="mr-1.5 text-gray-500" />
              词库进度
            </ToggleGroupItem>
            {errorWordData.length > 0 && (
              <>
                <ToggleGroupItem
                  value={Tab.Errors}
                  disabled={curTab === Tab.Errors}
                  className={`${curTab === Tab.Errors ? 'text-primary-foreground bg-primary' : ''} disabled:opacity-100`}
                >
                  <IcOutlineCollectionsBookmark className="mr-1.5 text-gray-500" />
                  查看错题
                </ToggleGroupItem>
                <ToggleGroupItem
                  value={Tab.Review}
                  disabled={curTab === Tab.Review}
                  className={`${curTab === Tab.Review ? 'text-primary-foreground bg-primary' : ''} disabled:opacity-100`}
                >
                  <PajamasReviewList className="mr-1.5 text-gray-500" />
                  错题回顾
                </ToggleGroupItem>
              </>
            )}
          </ToggleGroup>
        </div>
      </div>
      <div className="flex pl-0">
        <Tabs value={curTab} className="h-[30rem] w-full ">
          <TabsContent value={Tab.Chapters} className="h-full">
            <div className="flex h-full w-full flex-col pt-1">
              <div className="w-full rounded-2xl bg-white/70 p-6 shadow-sm dark:bg-gray-800/60">
                <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{dict.name} · 学习进度</div>
                <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  已学 {learned == null ? '…' : learned} / {totalWords} 词（{progress}%）
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-4 text-sm leading-6 text-gray-500 dark:text-gray-400">
                  当前版本按记忆曲线自动出词，不再按章节练习：每天从「到期复习词 + 当前水平未学词」中随机取词。点下面按钮可把该词库设为当前词库并回到练习页。
                </div>
                <button
                  className="my-btn-primary mt-4 rounded-lg bg-indigo-500 px-4 py-1.5 text-sm text-white hover:bg-indigo-400"
                  onClick={onStartManual}
                >
                  用该词库练习
                </button>
              </div>
            </div>
          </TabsContent>
          <TabsContent value={Tab.Errors} className="h-full">
            <ErrorTable data={tableData} isLoading={isLoading} error={error} onDelete={onDelete} />
          </TabsContent>
          <TabsContent value={Tab.Review} className="h-full">
            <ReviewDetail errorData={errorWordData} dict={dict} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
