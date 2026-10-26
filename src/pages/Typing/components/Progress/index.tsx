import { TypingContext } from '../../store'
import { useContext, useEffect, useState } from 'react'

export default function Progress({ className }: { className?: string }) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState(0)

  const colorSwitcher: { [key: number]: string } = {
    0: 'bg-indigo-200 dark:bg-indigo-300',
    1: 'bg-indigo-300 dark:bg-indigo-400',
    2: 'bg-indigo-400 dark:bg-indigo-500',
  }

  useEffect(() => {
    // v9.4（TYP-012）：空词表时 words.length=0 会产生 NaN（width: NaN%），先兜底
    const total = state.chapterData.words.length || 1
    const newProgress = Math.min(100, Math.max(0, Math.floor((state.chapterData.index / total) * 100)))
    setProgress(newProgress)
    const colorPhase = Math.floor(newProgress / 33.4)
    setPhase(Number.isFinite(colorPhase) ? colorPhase : 0)
  }, [state.chapterData.index, state.chapterData.words.length])

  return (
    <div className={`relative w-1/4 pt-1 ${className}`}>
      <div className="mb-4 flex h-2 overflow-hidden rounded-xl bg-indigo-100 text-xs transition-all duration-300 dark:bg-indigo-200">
        <div
          style={{ width: `${progress}%` }}
          className={`flex flex-col justify-center whitespace-nowrap rounded-xl text-center text-white shadow-none transition-all duration-300 ${
            colorSwitcher[phase] ?? 'bg-indigo-200 dark:bg-indigo-300'
          }`}
        ></div>
      </div>
    </div>
  )
}
