import DropdownExport from './DropdownExport'
import ErrorRow from './ErrorRow'
import HeadWrongNumber from './HeadWrongNumber'
import Pagination from './Pagination'
import RowDetail from './RowDetail'
import { currentRowDetailAtom } from './store'
import { useErrorBookData } from './useErrorBookData'
import { useWrongReview } from './useWrongReview'
import CloseButton from '@/components/CloseButton'
import { LoadingUI } from '@/components/Loading'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

export function ErrorBook() {
  const {
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
    reload,
    handleDelete,
  } = useErrorBookData()
  const startWrongReview = useWrongReview(groupedRecords)
  const navigate = useNavigate()
  const currentRowDetail = useAtomValue(currentRowDetailAtom)

  const onBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  // v9.14（dsh，M4-004）：错题本此前没有任何键盘返回途径（其它页面都有 esc 返回）。
  // 详情弹层打开时它自己的 esc 负责关闭，这里让出，避免一次 esc 同时关详情 + 跳首页。
  useHotkeys(
    'esc',
    () => {
      if (currentRowDetail) return
      onBack()
    },
    { preventDefault: true },
    [currentRowDetail, onBack],
  )

  return (
    <>
      <div className={`relative flex h-screen w-full flex-col items-center pb-4 ease-in ${currentRowDetail ? 'blur-sm' : ''}`}>
        <div className="mr-8 mt-4 flex w-auto items-center justify-center self-end">
          <button
            className="my-btn-primary mr-6 rounded-lg bg-indigo-500 px-4 py-1.5 text-sm text-white hover:bg-indigo-400"
            onClick={startWrongReview}
          >
            错题回顾练习
          </button>
          <h1 className="font-lighter mr-4 w-auto self-end text-gray-500 opacity-70">Tip: 点击错误单词查看详细信息 </h1>
          <CloseButton className="h-7 w-7" onClose={onBack} />
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
                {isLoading ? (
                  <div className="flex h-56 items-center justify-center">
                    <LoadingUI />
                  </div>
                ) : loadError ? (
                  <div className="flex h-56 flex-col items-center justify-center gap-3 text-gray-500 dark:text-gray-400">
                    <span>错题本加载失败，请重试</span>
                    <button
                      type="button"
                      className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm text-white hover:bg-indigo-400"
                      onClick={reload}
                    >
                      重新加载
                    </button>
                  </div>
                ) : renderRecords.length === 0 ? (
                  <div className="flex h-56 items-center justify-center text-gray-400">
                    {groupedRecords.length === 0 ? '暂无错题，快去练习吧！' : '当前页没有记录'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {renderRecords.map((record) => (
                      <ErrorRow
                        key={`${record.dict}-${record.word}`}
                        record={record}
                        onDelete={() => handleDelete(record.word, record.dict)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent" orientation="vertical"></ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </div>
        </div>
        {totalPages > 0 && (
          <Pagination className="pt-3" page={currentPage} setPage={setPage} totalPages={totalPages} />
        )}
      </div>
      {currentRowDetail && <RowDetail currentRowDetail={currentRowDetail} allRecords={sortedRecords} />}
    </>
  )
}
