import type { FC } from 'react'
import { useCallback } from 'react'
import NextIcon from '~icons/ooui/next-ltr'
import PrevIcon from '~icons/ooui/next-rtl'

type IPaginationProps = {
  className?: string
  page: number
  setPage: (page: number) => void
  totalPages: number
}

export const ITEM_PER_PAGE = 20

const Pagination: FC<IPaginationProps> = ({ className, page, setPage, totalPages }) => {
  const canPrev = page > 1
  const canNext = page < totalPages

  const nextPage = useCallback(() => {
    if (!canNext) return
    setPage(page + 1)
  }, [canNext, page, setPage])

  const prevPage = useCallback(() => {
    if (!canPrev) return
    setPage(page - 1)
  }, [canPrev, page, setPage])

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        aria-label="上一页"
        disabled={!canPrev}
        className="cursor-pointer rounded-full bg-white p-2 text-indigo-500 shadow-md disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-indigo-300"
        onClick={prevPage}
      >
        <PrevIcon />
      </button>
      <span className="text-black dark:text-white">{`${page} / ${totalPages}`}</span>
      <button
        type="button"
        aria-label="下一页"
        disabled={!canNext}
        className="cursor-pointer rounded-full bg-white p-2 text-indigo-500 shadow-md disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800 dark:text-indigo-300"
        onClick={nextPage}
      >
        <NextIcon />
      </button>
    </div>
  )
}

export default Pagination
