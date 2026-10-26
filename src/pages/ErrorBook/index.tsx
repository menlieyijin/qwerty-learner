import DropdownExport from './DropdownExport'
import ErrorRow from './ErrorRow'
import type { ISortType } from './HeadWrongNumber'
import HeadWrongNumber from './HeadWrongNumber'
import Pagination, { ITEM_PER_PAGE } from './Pagination'
import RowDetail from './RowDetail'
import { currentRowDetailAtom } from './store'
import type { groupedWordRecords } from './type'
import { idDictionaryMap } from '@/resources/dictionary'
import { currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import type { Word } from '@/typings'
import { db, useDeleteWordRecord } from '@/utils/db'
import type { WordRecord } from '@/utils/db/record'
import { ReviewRecord } from '@/utils/db/record'
import { memoryKey } from '@/utils/memoryKey'
import { wordListFetcher } from '@/utils/wordListFetcher'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

/** v9.3：词典显示名（自定义词库不在 idDictionaryMap 里，回退显示命名空间） */
function dictDisplayName(dict: string): string {
  const info = idDictionaryMap[dict]
  if (info?.name) return info.name
  if (dict.startsWith('custom:')) return `自定义词库「${dict.slice('custom:'.length)}」`
  return dict || '未知词典'
}

/**
 * v9.3（数据层 P1）：删除前的影响预览（只读统计，不写库）。
 * 删除会同时移除该词在该词典下的全部 wordRecords 与对应 memoryRecord，
 * 因此这里明确列出条数与其他词典是否还有同词记录，避免误删不可恢复。
 */
async function buildDeleteConfirmText(word: string, dict: string): Promise<string> {
  let recordCount = 0
  let hasMemoryRecord = false
  let otherDicts: string[] = []
  let statsOk = true
  try {
    const [count, memoryRecord, sameWordRecords] = await Promise.all([
      db.wordRecords.where({ word, dict }).count(),
      db.memoryRecords.get(memoryKey(dict, word)),
      db.wordRecords.where('word').equals(word).toArray(),
    ])
    recordCount = count
    hasMemoryRecord = !!memoryRecord
    otherDicts = Array.from(new Set(sameWordRecords.map((record) => record.dict))).filter((item) => item !== dict)
  } catch (error) {
    // 统计失败不阻断删除流程，但不再展示条数，避免误导
    statsOk = false
    console.error('统计待删除记录失败：', error)
  }
  const lines = [
    `确认从错题本删除「${word}」？`,
    '',
    `词典：${dictDisplayName(dict)}`,
    statsOk
      ? `将删除 ${recordCount} 条练习记录（含答对记录）${hasMemoryRecord ? ' + 1 条记忆曲线记录' : '（未找到记忆曲线记录）'}`
      : '无法读取待删除记录数：仍会删除该词在该词典下的全部练习记录与记忆曲线记录',
    '删除后该词的复习进度会丢失，并重新进入新词池；累计/今日/到期统计会同步减少，此操作不可恢复。',
  ]
  if (otherDicts.length > 0) {
    lines.push(`注意：该单词在以下词典也有错题记录，本次只删除「${dictDisplayName(dict)}」：${otherDicts.map(dictDisplayName).join('、')}`)
  }
  return lines.join('\n')
}

export function ErrorBook() {
  const [groupedRecords, setGroupedRecords] = useState<groupedWordRecords[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = useMemo(() => Math.ceil(groupedRecords.length / ITEM_PER_PAGE), [groupedRecords.length])
  const [sortType, setSortType] = useState<ISortType>('asc')
  const navigate = useNavigate()
  const currentRowDetail = useAtomValue(currentRowDetailAtom)
  const currentDictId = useAtomValue(currentDictIdAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const { deleteWordRecord } = useDeleteWordRecord()
  const [reload, setReload] = useState(false)

  const onBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  const setPage = useCallback(
    (page: number) => {
      if (page < 1 || page > totalPages) return
      setCurrentPage(page)
    },
    [totalPages],
  )

  const setSort = useCallback(
    (sortType: ISortType) => {
      setSortType(sortType)
      setPage(1)
    },
    [setPage],
  )

  const sortedRecords = useMemo(() => {
    if (sortType === 'none') return groupedRecords
    return [...groupedRecords].sort((a, b) => {
      if (sortType === 'asc') {
        return a.wrongCount - b.wrongCount
      } else {
        return b.wrongCount - a.wrongCount
      }
    })
  }, [groupedRecords, sortType])

  const renderRecords = useMemo(() => {
    const start = (currentPage - 1) * ITEM_PER_PAGE
    const end = start + ITEM_PER_PAGE
    return sortedRecords.slice(start, end)
  }, [currentPage, sortedRecords])

  useEffect(() => {
    db.wordRecords
      .where('wrongCount')
      .above(0)
      .toArray()
      .then((records) => {
        const groups: groupedWordRecords[] = []

        records.forEach((record) => {
          let group = groups.find((g) => g.word === record.word && g.dict === record.dict)
          if (!group) {
            group = { word: record.word, dict: record.dict, records: [], wrongCount: 0 }
            groups.push(group)
          }
          group.records.push(record as WordRecord)
        })

        groups.forEach((group) => {
          group.wrongCount = group.records.reduce((acc, cur) => {
            acc += cur.wrongCount
            return acc
          }, 0)
        })

        setGroupedRecords(groups)
      })
  }, [reload])

  const handleDelete = async (word: string, dict: string) => {
    // v9.3：先确认并展示影响（条数/词典/不可恢复），取消则不删
    const confirmed = window.confirm(await buildDeleteConfirmText(word, dict))
    if (!confirmed) return
    await deleteWordRecord(word, dict)
    setReload((prev) => !prev)
  }

  // v7：保留官方「错题回顾」功能，入口移到错题本（不再依赖词典章节弹窗）
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
    const words = groups.map((g) => list.find((w) => w.name === g.word)).filter(Boolean) as Word[]
    if (!words.length) {
      alert('没有可复习的错题')
      return
    }
    setReviewModeInfo({ isReviewMode: true, reviewRecord: new ReviewRecord(dict.id, words) })
    navigate('/')
  }, [currentDictId, groupedRecords, navigate, setReviewModeInfo])

  return (
    <>
      <div className={`relative flex h-screen w-full flex-col items-center pb-4 ease-in ${currentRowDetail && 'blur-sm'}`}>
        <div className="mr-8 mt-4 flex w-auto items-center justify-center self-end">
          <button
            className="my-btn-primary mr-6 rounded-lg bg-indigo-500 px-4 py-1.5 text-sm text-white hover:bg-indigo-400"
            onClick={startWrongReview}
          >
            错题回顾练习
          </button>
          <h1 className="font-lighter mr-4 w-auto self-end text-gray-500 opacity-70">Tip: 点击错误单词查看详细信息 </h1>
          <IconX className="h-7 w-7 cursor-pointer text-gray-400" onClick={onBack} />
        </div>

        <div className="flex w-full flex-1 select-text items-start justify-center overflow-hidden">
          <div className="flex h-full w-5/6 flex-col pt-10">
            <div className="flex w-full justify-between rounded-lg bg-white px-6 py-5 text-lg text-black shadow-lg dark:bg-gray-800 dark:text-white">
              <span className="basis-2/12">单词</span>
              <span className="basis-6/12">释义</span>
              <HeadWrongNumber className="basis-1/12" sortType={sortType} setSortType={setSort} />
              <span className="basis-1/12">词典</span>
              <DropdownExport renderRecords={sortedRecords} />
            </div>
            <ScrollArea.Root className="flex-1 overflow-y-auto pt-5">
              <ScrollArea.Viewport className="h-full  ">
                <div className="flex flex-col gap-3">
                  {renderRecords.map((record) => (
                    <ErrorRow
                      key={`${record.dict}-${record.word}`}
                      record={record}
                      onDelete={() => handleDelete(record.word, record.dict)}
                    />
                  ))}
                </div>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent" orientation="vertical"></ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </div>
        </div>
        <Pagination className="pt-3" page={currentPage} setPage={setPage} totalPages={totalPages} />
      </div>
      {currentRowDetail && <RowDetail currentRowDetail={currentRowDetail} allRecords={sortedRecords} />}
    </>
  )
}
