import { KEY_SOUND_URL_PREFIX, SOUND_URL_PREFIX, keySoundResources } from '@/resources/soundResource'
import { hintSoundsConfigAtom, keySoundsConfigAtom } from '@/store'
import noop from '@/utils/noop'
import type { Howl } from 'howler'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import useSound from 'use-sound'

export type PlayFunction = ReturnType<typeof useSound>[0]

/** use-sound@4.0.1 在 src 变化/组件卸载时不会 unload 旧 Howl，这里显式回收（AUDIO-007）。 */
function useUnloadHowlOnChange(sound: Howl | null | undefined) {
  useEffect(() => {
    if (!sound) return
    return () => {
      try {
        sound.unload()
      } catch {
        /* ignore */
      }
    }
  }, [sound])
}

export default function useKeySound(): [PlayFunction, PlayFunction, PlayFunction] {
  const { isOpen: isKeyOpen, isOpenClickSound, volume: keyVolume, resource: keyResource } = useAtomValue(keySoundsConfigAtom)
  const setKeySoundsConfig = useSetAtom(keySoundsConfigAtom)
  const {
    isOpen: isHintOpen,
    isOpenWrongSound,
    isOpenCorrectSound,
    volume: hintVolume,
    wrongResource,
    correctResource,
  } = useAtomValue(hintSoundsConfigAtom)
  const [keySoundUrl, setKeySoundUrl] = useState(`${KEY_SOUND_URL_PREFIX}${keyResource.filename}`)

  useEffect(() => {
    if (!keySoundResources.some((item) => item.filename === keyResource.filename && item.key === keyResource.key)) {
      const defaultKeySoundResource = keySoundResources.find((item) => item.key === 'Default') || keySoundResources[0]

      setKeySoundUrl(`${KEY_SOUND_URL_PREFIX}${defaultKeySoundResource.filename}`)
      setKeySoundsConfig((prev) => ({ ...prev, resource: defaultKeySoundResource }))
    }
  }, [keyResource, setKeySoundsConfig])

  const [playClickSound, { sound: clickSound }] = useSound(keySoundUrl, {
    volume: keyVolume,
    interrupt: true,
  })
  const [playWrongSound, { sound: wrongSound }] = useSound(`${SOUND_URL_PREFIX}${wrongResource.filename}`, {
    volume: hintVolume,
    interrupt: true,
  })
  const [playCorrectSound, { sound: correctSound }] = useSound(`${SOUND_URL_PREFIX}${correctResource.filename}`, {
    volume: hintVolume,
    interrupt: true,
  })

  useUnloadHowlOnChange(clickSound as Howl | null | undefined)
  useUnloadHowlOnChange(wrongSound as Howl | null | undefined)
  useUnloadHowlOnChange(correctSound as Howl | null | undefined)

  return [
    isKeyOpen && isOpenClickSound ? playClickSound : noop,
    isHintOpen && isOpenWrongSound ? playWrongSound : noop,
    isHintOpen && isOpenCorrectSound ? playCorrectSound : noop,
  ]
}
