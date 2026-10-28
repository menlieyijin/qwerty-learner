import type { ISortType } from './HeadWrongNumber'
import { ITEM_PER_PAGE } from './Pagination'
import type { groupedWordRecords } from './type'
import { buildDeleteConfirmText } from './deleteConfirm'
import { useDeleteWordRecord } from '@/hooks/useRecordMutations'
import { db } from '@/utils/db'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * 错题本数据层：分组加载 / 分页 / 排序 / 删除重载。
 * 只负责状态与回调，渲染仍留在 index.tsx。
 */
export function useErrorBookData() {
  const [groupedRecords, setGroupedRecords] = useState<groupedWordRecords[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const totalPages = useMemo(() => Math.ceil(groupedRecords.length / ITEM_PER_PAGE), [groupedRecords.length])
  const [sortType, setSortType] = useState<ISortType>('asc')
  const { deleteWordRecord } = useDeleteWordRecord()
  const [reload, setReload] = useState(false)
  // PAGES-006/013：区分“加载中 / 加载失败 / 确实没有错题”三种状态，避免数据库异常时永久空白
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // PAGES-005：删除或重新加载后总页数可能变小，把 currentPage 收敛到合法范围，
  // 避免停留在越界页导致列表空白、分页显示「2 / 1」。
  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(1, page), Math.max(1, totalPages)))
  }, [totalPages])

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
    let cancelled = false
    setIsLoading(true)
    setLoadError(false)

    db.wordRecords
      .where('wrongCount')
      .above(0)
      .toArray()
      .then((records) => {
        if (cancelled) return
        const groups: groupedWordRecords[] = []
        // v9.14（dsh，M4-012）：分组从 groups.find（O(n·m)）改为 Map 索引；
        // key 用 \u0000 分隔，避免 dict+word 直接拼接撞键。插入顺序与结果集合不变。
        const groupMap = new Map<string, groupedWordRecords>()

        records.forEach((record) => {
          const key = `${record.dict}\u0000${record.word}`
          let group = groupMap.get(key)
          if (!group) {
            group = { word: record.word, dict: record.dict, records: [], wrongCount: 0 }
            groupMap.set(key, group)
            groups.push(group)
          }
          // v9.14（dsh，M4-017）：db.wordRecords 已是 Table<WordRecord>，无需再 as
          group.records.push(record)
        })

        groups.forEach((group) => {
          group.wrongCount = group.records.reduce((acc, cur) => {
            acc += cur.wrongCount
            return acc
          }, 0)
        })

        setGroupedRecords(groups)
      })
      .catch((error) => {
        if (cancelled) return
        // PAGES-013：IndexedDB 打不开/查询失败时给出可重试的错误态，而不是静默空白
        console.error('错题本读取失败：', error)
        setLoadError(true)
        setGroupedRecords([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reload])

  const handleDelete = async (word: string, dict: string) => {
    // v9.3：先确认并展示影响（条数/词典/不可恢复），取消则不删
    const confirmed = window.confirm(await buildDeleteConfirmText(word, dict))
    if (!confirmed) return
    await deleteWordRecord(word, dict)
    setReload((prev) => !prev)
  }

  return {
    groupedRecords,
    totalPages,
    currentPage,
    sortType,
    setSort,
    setPage,
    sortedRecords,
    renderRecords,
    isLoading,
    loadError,
    reload: () => setReload((prev) => !prev),
    handleDelete,
  }
}
