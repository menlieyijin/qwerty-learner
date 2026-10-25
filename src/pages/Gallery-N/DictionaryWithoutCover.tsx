import { useMemoryDictStats } from './hooks/useMemoryDictStats'
import bookCover from '@/assets/book-cover.png'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import useIntersectionObserver from '@/hooks/useIntersectionObserver'
import { currentDictIdAtom, learningModeAtom, reviewModeInfoAtom } from '@/store'
import type { Dictionary } from '@/typings'
import * as Progress from '@radix-ui/react-progress'
import { useAtomValue, useSetAtom } from 'jotai'
import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

interface Props {
  dictionary: Dictionary
}

export default function DictionaryComponent({ dictionary }: Props) {
  const currentDictID = useAtomValue(currentDictIdAtom)
  const learningMode = useAtomValue(learningModeAtom)
  const setLearningMode = useSetAtom(learningModeAtom)
  const setCurrentDictID = useSetAtom(currentDictIdAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()

  const divRef = useRef<HTMLDivElement>(null)
  const entry = useIntersectionObserver(divRef, {})
  const isVisible = !!entry?.isIntersecting
  const learnedCount = useMemoryDictStats(dictionary.id, isVisible)
  const progress = useMemo(
    () => (learnedCount === null ? 0 : Math.min(100, Math.round((learnedCount / Math.max(1, dictionary.length)) * 100))),
    [learnedCount, dictionary.length],
  )
  const isSelected = learningMode === 'manual' && currentDictID === dictionary.id

  const onChoose = () => {
    setLearningMode('manual')
    setCurrentDictID(dictionary.id)
    setReviewModeInfo(() => ({ isReviewMode: false, reviewRecord: undefined }))
    navigate('/')
  }

  return (
    <div
      ref={divRef}
      onClick={onChoose}
      title="开始记忆曲线练习（随机出词，不分章节）"
      className={`group flex h-36 w-80 cursor-pointer items-center justify-center overflow-hidden rounded-lg p-4 text-left shadow-lg focus:outline-none ${
        isSelected ? 'bg-indigo-400' : 'bg-zinc-50 hover:bg-white dark:bg-gray-800 dark:hover:bg-gray-700'
      }`}
      role="button"
    >
      <div className="relative ml-1 mt-2 flex h-full w-full flex-col items-start justify-start">
        <h1
          className={`mb-1.5 text-xl font-normal  ${
            isSelected ? 'text-white' : 'text-gray-800 group-hover:text-indigo-400 dark:text-gray-200'
          }`}
        >
          {dictionary.name}
        </h1>
        <TooltipProvider>
          <Tooltip delayDuration={400}>
            <TooltipTrigger asChild>
              <p
                className={`mb-1 max-w-full truncate ${
                  isSelected ? 'text-white' : 'textdelayDuration-gray-600 dark:text-gray-200'
                } whitespace-nowrap`}
              >
                {dictionary.description}
              </p>
            </TooltipTrigger>
            <TooltipContent>
              <p>{`${dictionary.description}`}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <p className={`mb-0.5 font-bold  ${isSelected ? 'text-white' : 'text-gray-600 dark:text-gray-200'}`}>
          {dictionary.length} 词{learnedCount !== null ? ` · 已学 ${learnedCount}` : ''}
        </p>
        <div className=" flex w-full items-center pt-2">
          {progress > 0 && (
            <Progress.Root
              value={progress}
              max={100}
              className={`mr-4 h-2 w-full rounded-full border  bg-white ${isSelected ? 'border-indigo-600' : 'border-indigo-400'}`}
            >
              <Progress.Indicator
                className={`h-full rounded-full pl-0 ${isSelected ? 'bg-indigo-600' : 'bg-indigo-400'}`}
                style={{ width: `calc(${progress}% )` }}
              />
            </Progress.Root>
          )}
          <img src={bookCover} className={`absolute right-3 top-3 w-16 ${isSelected ? 'opacity-50' : 'opacity-20'}`} />
        </div>
      </div>
    </div>
  )
}
