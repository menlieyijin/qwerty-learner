import KeyEventHandler from '../KeyEventHandler'
import TextAreaHandler from '../TextAreaHandler'
import type { WordUpdateAction } from '../types'
import { currentDictInfoAtom } from '@/store'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'

export default function InputHandler({ updateInput }: { updateInput: (updateObj: WordUpdateAction) => void }) {
  const dictInfo = useAtomValue(currentDictInfoAtom)

  const handler = useMemo(() => {
    switch (dictInfo.language) {
      case 'en':
        return <KeyEventHandler updateInput={updateInput} />
      case 'de':
        return <KeyEventHandler updateInput={updateInput} />
      case 'romaji':
        return <KeyEventHandler updateInput={updateInput} />
      case 'code':
        return <TextAreaHandler updateInput={updateInput} />
      default:
        return <TextAreaHandler updateInput={updateInput} />
    }
  }, [dictInfo.language, updateInput])

  return <>{handler}</>
}
