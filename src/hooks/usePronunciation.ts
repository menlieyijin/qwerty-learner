import { pronunciationConfigAtom } from '@/store'
import type { PronunciationType } from '@/typings'
import { romajiToHiragana } from '@/utils/kana'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
 * AUDIO-004 / 方案 C（v9.7）：单词发音改为原生 HTMLAudioElement 直放。
 *
 * 为什么不再用 use-sound(Howler html5)：
 * - Howler 的 `<audio>` 是「换词那一帧才创建并开始下载」，而 v9.6 又要求「Howl.loaded 之后才 play」，
 *   于是极速连打时（词窗口 40~200ms < 有道 mp3 加载 145~184ms）播放请求会被换词 cleanup 的 unload 中止；
 * - 原生 `HTMLAudioElement.play()` 只要 src 已设置就会排队缓冲、缓冲就绪后自动开始，不会丢请求。
 * 因此这里：每个 URL 复用一个元素（预取与播放共用，预取首次真正有意义），换词时 pause 旧元素（不 unload，
 * 保留已下载数据、复习/循环再遇同词可瞬发），并且同一时刻只允许一个元素发声（杜绝串词）。
 */
const PREFETCH_CACHE_LIMIT = 24
/** URL -> 原生音频元素（预取与播放共用同一元素） */
const soundCache = new Map<string, HTMLAudioElement>()
/** 当前占用的元素（同一时刻只允许一个词发声；换词/卸载时精确暂停，杜绝串词） */
let activeAudio: HTMLAudioElement | null = null

function acquireAudio(url: string): HTMLAudioElement {
  let element = soundCache.get(url)
  if (!element) {
    element = new Audio()
    element.preload = 'auto' // 与原 Howl 的 preload=true 等价；赋值 src 即开始加载
    element.src = url
    element.style.display = 'none'
    try {
      document.head.appendChild(element)
    } catch {
      /* ignore */
    }
    soundCache.set(url, element)
  }

  // AUDIO-005/R-007：容量上限 24，只淘汰“非当前占用”的旧元素，避免把正在播的元素清掉。
  if (soundCache.size > PREFETCH_CACHE_LIMIT) {
    for (const [key, old] of soundCache) {
      if (soundCache.size <= PREFETCH_CACHE_LIMIT) break
      if (old === activeAudio || old === element) continue
      soundCache.delete(key)
      try {
        old.removeAttribute('src')
        old.load()
      } catch {
        /* ignore */
      }
      try {
        old.remove()
      } catch {
        /* ignore */
      }
    }
  }
  return element
}

function stopAudio(element: HTMLAudioElement) {
  try {
    element.pause()
    element.currentTime = 0
  } catch {
    /* ignore */
  }
  if (activeAudio === element) activeAudio = null
}

function playAudio(url: string, options: { volume: number; rate: number; loop: boolean }): HTMLAudioElement {
  const element = acquireAudio(url)
  // 换词/换源即停掉上一个词：元素按 URL 隔离，不会串词。
  if (activeAudio && activeAudio !== element) stopAudio(activeAudio)
  activeAudio = element
  try {
    element.volume = Math.min(1, Math.max(0, options.volume))
    element.playbackRate = options.rate
    element.loop = options.loop
  } catch {
    /* ignore */
  }
  try {
    element.currentTime = 0
  } catch {
    /* ignore */
  }
  // 关键：不判断 readyState/loaded，直接 play()。原生播放器会在缓冲就绪后自动开始，
  // 这补上了 v9.6「等 Howl.loaded 才播」在极速连打时必然漏发的缺口。
  const playPromise = element.play() as Promise<void> | undefined
  playPromise?.catch((error: unknown) => {
    const name = (error as { name?: string })?.name
    // 换词/暂停打断未完成的 play 属预期行为，静默；其它错误保留日志便于排查。
    if (name !== 'AbortError' && name !== 'NotAllowedError') {
      console.error('play pronunciation failed', error)
    }
  })
  return element
}

export default function usePronunciationSound(word: string, isLoop?: boolean) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)
  const loop = useMemo(() => (typeof isLoop === 'boolean' ? isLoop : pronunciationConfig.isLoop), [isLoop, pronunciationConfig.isLoop])
  const [isPlaying, setIsPlaying] = useState(false)
  const src = useMemo(() => generateWordSoundSrc(word, pronunciationConfig.type), [word, pronunciationConfig.type])

  const volume = pronunciationConfig.volume
  const rate = pronunciationConfig.rate ?? 1
  const elementRef = useRef<HTMLAudioElement | null>(null)

  // 词/发音变化：绑定元素并挂播放状态监听。本 effect 只做生命周期，不自动 play（自动播放由调用方决定）。
  useEffect(() => {
    if (!src) {
      elementRef.current = null
      return
    }
    const element = acquireAudio(src)
    element.volume = Math.min(1, Math.max(0, volume))
    element.playbackRate = rate
    element.loop = loop
    elementRef.current = element

    const onStart = () => setIsPlaying(true)
    const onStop = () => setIsPlaying(false)
    element.addEventListener('play', onStart)
    element.addEventListener('playing', onStart)
    element.addEventListener('ended', onStop)
    element.addEventListener('pause', onStop)
    element.addEventListener('error', onStop)

    return () => {
      element.removeEventListener('play', onStart)
      element.removeEventListener('playing', onStart)
      element.removeEventListener('ended', onStop)
      element.removeEventListener('pause', onStop)
      element.removeEventListener('error', onStop)
      // 换词/卸载：立即停掉旧词（只 pause，不 unload、不丢已下载数据；元素留缓存供复习/循环复用）。
      if (activeAudio === element) stopAudio(element)
      if (elementRef.current === element) elementRef.current = null
    }
    // 音量/倍速/循环不进依赖，避免与换词生命周期耦合（见下方同步 effect）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // AUDIO-002：运行期同步音量/倍速/循环（改音量不会把倍速打回 1，改倍速立即作用于当前元素）。
  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    try {
      element.volume = Math.min(1, Math.max(0, volume))
      element.playbackRate = rate
      element.loop = loop
    } catch {
      /* ignore */
    }
  }, [volume, rate, loop, src])

  const play = useCallback(() => {
    if (!src) return
    elementRef.current = playAudio(src, { volume, rate, loop })
  }, [src, volume, rate, loop])

  // stop 保持稳定引用：WordPronunciationIcon 的 `useEffect(() => () => stop, [word, stop])` 会在换词时
  // 执行 cleanup，如果 stop 依赖 word 会换成新元素引用；这里读 ref，先于新 play 执行时停的仍是旧元素。
  const stop = useCallback(() => {
    const element = elementRef.current
    if (element) stopAudio(element)
  }, [])

  return { play, stop, isPlaying }
}

export function usePrefetchPronunciationSound(word: string | undefined) {
  const pronunciationConfig = useAtomValue(pronunciationConfigAtom)

  useEffect(() => {
    if (!word) return
    const soundUrl = generateWordSoundSrc(word, pronunciationConfig.type)
    if (!soundUrl) return
    // 与播放共用同一缓存：预取的字节第一次真正被播放侧复用（AUDIO-005）。
    acquireAudio(soundUrl)
  }, [pronunciationConfig.type, word])
}
