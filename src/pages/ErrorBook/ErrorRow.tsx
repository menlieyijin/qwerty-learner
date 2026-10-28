import { LoadingWordUI } from './LoadingWordUI'
import useGetWord from './hooks/useGetWord'
import { currentRowDetailAtom } from './store'
import type { groupedWordRecords } from './type'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { idDictionaryMap } from '@/resources/dictionary'
import { recordErrorBookAction } from '@/utils/mixpanel'
import { useSetAtom } from 'jotai'
import type { FC } from 'react'
import { useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import DeleteIcon from '~icons/weui/delete-filled'

type IErrorRowProps = {
  record: groupedWordRecords
  onDelete: () => void
}

const ErrorRow: FC<IErrorRowProps> = ({ record, onDelete }) => {
  const setCurrentRowDetail = useSetAtom(currentRowDetailAtom)
  const dictInfo = idDictionaryMap[record.dict]
  const { word, isLoading, hasError } = useGetWord(record.word, dictInfo, record.dict)

  const onClick = useCallback(() => {
    setCurrentRowDetail(record)
    recordErrorBookAction('detail')
  }, [record, setCurrentRowDetail])

  // PAGES-009：整行可点击但原本只能用鼠标，补键盘可达（Tab 聚焦 + Enter/Space 触发）
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onClick()
      }
    },
    [onClick],
  )

  return (
    <li
      className="opacity-85 flex w-full cursor-pointer items-center justify-between rounded-lg bg-white px-6 py-3 text-black shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:bg-gray-800 dark:text-white"
      role="button"
      tabIndex={0}
      aria-label={`查看「${record.word}」的错题详情`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className="basis-2/12 break-normal">{record.word}</span>
      <span className="basis-6/12 break-normal">
        {word ? word.trans.join('；') : <LoadingWordUI isLoading={isLoading} hasError={hasError} />}
      </span>
      <span className="basis-1/12 break-normal pl-8">{record.wrongCount}</span>
      <span className="basis-1/12 break-normal">{dictInfo?.name}</span>
      <button
        type="button"
        aria-label={`删除「${record.word}」的错题记录`}
        className="basis-1/12 break-normal"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <DeleteIcon />
            </TooltipTrigger>
            <TooltipContent>
              <p>Delete Records</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </button>
    </li>
  )
}

export default ErrorRow
