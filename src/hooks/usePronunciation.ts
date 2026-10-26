import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { addHowlListener } from '@/utils'
import { romajiToHiragana } from '@/utils/kana'
import type { Howl } from 'howler'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import useSound from 'use-sound'
import type { HookOptions } from 'use-sound/dist/types'

const pronunciationApi = 'https://dict.youdao.com/dictvoice?audio='

/**
 * 生成有道发音 URL。
 * AUDIO-001：word 必须经过 encodeURIComponent，否则 AT&T 会被截断成 AT、
 * F# 的 # 会变成 fragment、C++ 的 + 会被解码为空格，导致发音读错词或无声。
 */
export function generateWordSoundSrc(word: string, pronunciation: Exclude<PronunciationType, false>): string {
  const encodedWord = encodeURIComponent(word)
  switch (pronunciation) {
    case 'uk':
      return `${pronunciationApi}${encodedWord}&type=1`
    case 'us':
      return `${pronunciationApi}${encodedWord}&type=2`
    case 'romaji':
      return `${pronunciationApi}${encodeURIComponent(romajiToHiragana(word))}&le=jap`
    case 'zh':
      return `${pronunciationApi}${encodedWord}&le=zh`
    case 'ja':
      return `${pronunciationApi}${encodedWord}&le=jap`
    case 'de':
      return `${pronunciationApi}${encodedWord}&le=de`
    case 'hapin':
    case 'kk':
      return `${pronunciationApi}${encodedWord}&le=ru` // 有道不支持哈萨克语, 暂时用俄语发音兜底
    case 'id':
      return `${pronunciationApi}${encodedWord}&le=id`
    default:
      return ''
  }
}

/**
 * 已预取的发音元素缓存（AUDIO-005）：
 * - 以发音 URL 为键去重，避免“查 link 却插 audio”导致预取永远不命中；
 * - 不设置 crossOrigin='anonymous'（有道未保证返回 CORS 头，设了反而使预取必失败）；
 * - 限制容量，避免长会话 DOM/Audio 无界增长。
 */
const PREFETCH_CACHE_LIMIT = 24
const prefetchCache = new Map<string, HTMLAudioElement>()

function prefetchPronunciationSound(soundUrl: string) {
  if (!soundUrl || prefetchCache.has(soundUrl)) return
  const audio = new Audio()
  audio.preload = 'auto'
  audio.src = soundUrl
  audio.style.display = 'none'
  document.head.appendChild(audio)
  prefetchCache.set(soundUrl, audio)

  if (prefetchCache.size > PREFETCH_CACHE_LIMIT) {
    const oldestKey = prefetchCache.keys().next().value as string | undefined
    if (oldestKey && oldestKey !== soundUrl) {
      const oldest = prefetchCache.get(oldestKey)
      prefetchCache.delete(oldestKey)
      try {
        oldest?.remove()
      } catch {
        /* ignore */
      }
    }
  }
}

export default function usePronunciationSound(word: string, isLoop?: boolean) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const loop = useMemo(() => (typeof isLoop === 'boolean' ? isLoop : pronunciationConfig.isLoop), [isLoop, pronunciationConfig.isLoop])
  const [isPlaying, setIsPlaying] = useState(false)

  const src = useMemo(() => generateWordSoundSrc(word, pronunciationConfig.type), [word, pronunciationConfig.type])

  // AUDIO-002：use-sound@4.0.1 运行期只认 playbackRate（rate 仅在创建 Howl 时作为构造参数生效），
  // 因此这里必须传 playbackRate，单独修改倍速才会作用于已加载的音频。
  const [play, { stop, sound }] = useSound(src, {
    html5: true,
    format: ['mp3'],
    loop,
    volume: pronunciationConfig.volume,
    playbackRate: pronunciationConfig.rate,
  } as HookOptions)

  // play 的引用会随 sound 变化；用 ref 持有最新引用，避免把它放进下面 effect 的依赖导致反复 unload。
  const playRef = useRef(play)
  playRef.current = play
  const soundRef = useRef<Howl | null>(null)
  const soundSrcRef = useRef<string>('')
  const prevSoundRef = useRef<Howl | null>(null)
  const pendingPlayRef = useRef(false)
  const prevSrcRef = useRef<string>('')

  // AUDIO-002：运行期同步音量/倍速（use-sound 内部对 playbackRate 的同步发生在它自己的 effect 里，
  // 这里再兜底一次，保证“改音量不会把倍速打回 1、改倍速立刻生效”）。
  useEffect(() => {
    if (!sound) return
    try {
      sound.volume(pronunciationConfig.volume)
      sound.rate(pronunciationConfig.rate ?? 1)
    } catch (e) {
      console.error('sync pronunciation volume/rate failed', e)
    }
  }, [sound, pronunciationConfig.volume, pronunciationConfig.rate])

  useEffect(() => {
    if (!sound) return
    sound.loop(loop)
    return undefined
  }, [loop, sound])

  useEffect(() => {
    if (!sound) return
    const howl = sound as Howl
    soundRef.current = howl

    // 新词（src 变化）时丢弃上一词遗留的“待播放”请求，避免串词。
    if (prevSrcRef.current !== src) {
      prevSrcRef.current = src
      pendingPlayRef.current = false
    }

    // 只有 sound 实例真正更换时才更新它对应的 src；src 变化但 Howl 尚未重建期间保持旧映射，
    // 这样播放请求会走“等待加载”的分支，而不是误播上一个词（AUDIO-004）。
    if (prevSoundRef.current !== howl) {
      prevSoundRef.current = howl
      soundSrcRef.current = src
    }

    const unListens: Array<() => void> = []
    unListens.push(addHowlListener(howl, 'play', () => setIsPlaying(true)))
    unListens.push(addHowlListener(howl, 'end', () => setIsPlaying(false)))
    unListens.push(addHowlListener(howl, 'pause', () => setIsPlaying(false)))
    unListens.push(addHowlListener(howl, 'stop', () => setIsPlaying(false)))
    unListens.push(addHowlListener(howl, 'playerror', () => setIsPlaying(false)))

    // AUDIO-004：音频加载完成时补播“新词自动发音”的请求（之前 play 在 sound 未就绪时会被静默丢弃）。
    const playPendingIfReady = () => {
      if (!pendingPlayRef.current) return
      if (soundSrcRef.current !== src) return
      if (howl.state() !== 'loaded') return
      pendingPlayRef.current = false
      setIsPlaying(true)
      try {
        playRef.current()
      } catch (e) {
        console.error('play pending pronunciation failed', e)
        setIsPlaying(false)
      }
    }
    unListens.push(addHowlListener(howl, 'load', playPendingIfReady))

    return () => {
      setIsPlaying(false)
      unListens.forEach((unListen) => unListen())
      // 换词/切换发音类型时卸载旧 Howl，避免音频元素与解码资源泄漏（AUDIO-007）。
      ;(howl as Howl).unload()
    }
  }, [sound, src])

  /**
   * 播放当前词发音：
   * - Howl 已加载且属于当前词 -> 立即播放；
   * - 还在加载（新词第一次加载的常见情况）-> 记为待播放，由 'load' 监听补播（AUDIO-004）。
   */
  const playSound = useMemo(
    () => () => {
      const howl = soundRef.current
      if (howl && soundSrcRef.current === src && howl.state() === 'loaded') {
        pendingPlayRef.current = false
        setIsPlaying(true)
        playRef.current()
        return
      }
      pendingPlayRef.current = true
    },
    [src],
  )

  const stopSound = useMemo(
    () => () => {
      pendingPlayRef.current = false
      setIsPlaying(false)
      stop()
    },
    [stop],
  )

  return { play: playSound, stop: stopSound, isPlaying }
}

export function usePrefetchPronunciationSound(word: string | undefined) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)

  useEffect(() => {
    if (!word) return
    const soundUrl = generateWordSoundSrc(word, pronunciationConfig.type)
    if (soundUrl === '') return
    prefetchPronunciationSound(soundUrl)
  }, [pronunciationConfig.type, word])
}
