import { useCallback, useEffect, useRef, useState } from 'react'

export type UseSpeechResult = {
  /**
   * Speak speaking
   * @param {boolean} [abort=false] Whether to cancel other speak
   */
  speak: (abort?: boolean) => void
  /**
   * Cancel speaking
   */
  cancel: () => void
  /**
   * Whether currently speaking
   */
  speaking: boolean
}

/** Chromium 的 speechSynthesis.cancel() 是异步清队列的，cancel 后同 tick 立即 speak 有概率被吞掉。 */
const SPEAK_AFTER_CANCEL_DELAY = 80
const VOICES_WAIT_TIMEOUT = 1200

function detectSpeechLang(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return 'ja-JP' // 平假名/片假名
  if (/[\uac00-\ud7af]/.test(text)) return 'ko-KR' // 韩文
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh-CN' // 中日韩统一表意文字
  if (/[\u0400-\u04ff]/.test(text)) return 'ru-RU' // 西里尔字母
  if (/[\u0600-\u06ff]/.test(text)) return 'ar-SA' // 阿拉伯字母
  return 'en-US'
}

function pickVoiceForLang(synth: SpeechSynthesis, lang: string): SpeechSynthesisVoice | null {
  let voices: SpeechSynthesisVoice[] = []
  try {
    voices = synth.getVoices?.() || []
  } catch {
    return null
  }
  const target = lang.toLowerCase()
  const exact = voices.find((voice) => voice.lang?.toLowerCase() === target)
  if (exact) return exact
  const prefix = target.split('-')[0]
  return voices.find((voice) => voice.lang?.toLowerCase().startsWith(prefix)) || null
}

function waitForVoices(synth: SpeechSynthesis, timeout = VOICES_WAIT_TIMEOUT): Promise<SpeechSynthesisVoice[]> {
  try {
    const existing = synth.getVoices?.() || []
    if (existing.length > 0) return Promise.resolve(existing)
  } catch {
    return Promise.resolve([])
  }
  return new Promise((resolve) => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      synth.removeEventListener('voiceschanged', onVoicesChanged)
      window.clearTimeout(timer)
      try {
        resolve(synth.getVoices?.() || [])
      } catch {
        resolve([])
      }
    }
    const onVoicesChanged = () => {
      try {
        if ((synth.getVoices?.() || []).length > 0) finish()
      } catch {
        finish()
      }
    }
    const timer = window.setTimeout(finish, timeout)
    synth.addEventListener('voiceschanged', onVoicesChanged)
  })
}

let unavailableHintShown = false

/** AUDIO-008：系统没有任何语音引擎时只提示一次，而不是让用户点了没反应。 */
function showSpeechUnavailableHintOnce() {
  if (unavailableHintShown || typeof document === 'undefined') return
  unavailableHintShown = true
  const hint = document.createElement('div')
  hint.setAttribute('role', 'status')
  hint.textContent = '当前系统没有可用的语音合成引擎，释义朗读不可用'
  hint.style.cssText =
    'position:fixed;left:50%;bottom:48px;transform:translateX(-50%);z-index:9999;background:rgba(17,24,39,.92);color:#fff;' +
    'font-size:13px;line-height:20px;padding:8px 14px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none;'
  document.body.appendChild(hint)
  window.setTimeout(() => {
    hint.remove()
  }, 4000)
}

/**
 * React hook for using the SpeechSynthesis API.
 * @param {string} text The text to be spoken.
 * @param {Partial<SpeechSynthesisUtterance>} option SpeechSynthesisUtterance API option. {@link https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance#instance_properties}
 * @returns {Object} An object containing `speak`, `cancel` methods and `speaking` state.
 * @throws {Error} If browser not support SpeechSynthesis API.
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API}
 */
export default function useSpeech(text: string, option?: Partial<SpeechSynthesisUtterance>): UseSpeechResult {
  const [speaking, setSpeaking] = useState(false)
  const [utterance, setUtterance] = useState<SpeechSynthesisUtterance | null>(null)
  // utterance 必须被持有引用（同时保存在 state 与 ref 中），避免 Chrome 的“utterance 被 GC 后 onend 不触发”。
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const pendingSpeakTimerRef = useRef<number | undefined>(undefined)
  // 单调递增序号：cancel/换词后旧的异步流程（等待 voices）不能再发声。
  const speakSeqRef = useRef(0)

  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      console.error('SpeechSynthesis API is not supported in this browser')
      return
    }

    const newUtterance = new SpeechSynthesisUtterance(text)
    Object.assign(newUtterance, option)
    // AUDIO-008：按待朗读文本的书写系统设置 lang，避免用系统默认语音念错语种。
    if (!newUtterance.lang) {
      newUtterance.lang = detectSpeechLang(text)
    }
    utteranceRef.current = newUtterance
    setUtterance(newUtterance)

    // voices 可能是异步加载的；拿到后再按 lang 选 voice（不阻塞渲染）。
    const applyVoice = () => {
      if (utteranceRef.current !== newUtterance) return
      const voice = pickVoiceForLang(synth, newUtterance.lang)
      if (voice) newUtterance.voice = voice
    }
    applyVoice()
    synth.addEventListener('voiceschanged', applyVoice)

    return () => {
      synth.removeEventListener('voiceschanged', applyVoice)
      speakSeqRef.current += 1
      window.clearTimeout(pendingSpeakTimerRef.current)
      pendingSpeakTimerRef.current = undefined
      synth.cancel()
      utteranceRef.current = null
      setSpeaking(false)
    }
  }, [option, text])

  useEffect(() => {
    if (!utterance) return
    // AUDIO-003：start/end/error 三态都要维护 speaking，不能只监听 end（否则被策略拦截或
    // cancel 吞掉时 speaking 永久为 true，图标一直转圈）。
    const onStart = () => setSpeaking(true)
    const onEnd = () => setSpeaking(false)
    const onError = () => setSpeaking(false)
    utterance.addEventListener('start', onStart)
    utterance.addEventListener('end', onEnd)
    utterance.addEventListener('error', onError)
    return () => {
      utterance.removeEventListener('start', onStart)
      utterance.removeEventListener('end', onEnd)
      utterance.removeEventListener('error', onError)
    }
  }, [utterance])

  const speak = useCallback((abort = false) => {
    const synth = window.speechSynthesis
    const current = utteranceRef.current
    if (!synth || !current) return

    const seq = ++speakSeqRef.current
    window.clearTimeout(pendingSpeakTimerRef.current)
    pendingSpeakTimerRef.current = undefined

    const doSpeak = () => {
      if (seq !== speakSeqRef.current) return
      // AUDIO-008：voices 为空时等待一次（Chromium 异步加载），仍为空则提示一次并不发声。
      const startSpeak = () => {
        if (seq !== speakSeqRef.current) return
        setSpeaking(true)
        try {
          synth.speak(current)
        } catch (e) {
          console.error('speechSynthesis.speak failed', e)
          setSpeaking(false)
        }
      }
      let voices: SpeechSynthesisVoice[] = []
      try {
        voices = synth.getVoices?.() || []
      } catch {
        voices = []
      }
      if (voices.length > 0) {
        startSpeak()
        return
      }
      void waitForVoices(synth).then((loadedVoices) => {
        if (seq !== speakSeqRef.current) return
        if (loadedVoices.length === 0) {
          setSpeaking(false)
          showSpeechUnavailableHintOnce()
          return
        }
        startSpeak()
      })
    }

    if (abort && (synth.speaking || synth.pending)) {
      // AUDIO-003：先 cancel 并复位状态，再延迟一拍 speak，规避 cancel/speak 同 tick 的 Chromium 竞态。
      synth.cancel()
      setSpeaking(false)
      pendingSpeakTimerRef.current = window.setTimeout(() => {
        pendingSpeakTimerRef.current = undefined
        doSpeak()
      }, SPEAK_AFTER_CANCEL_DELAY)
      return
    }

    doSpeak()
  }, [])

  const cancel = useCallback(() => {
    // AUDIO-003：cancel 时无条件复位 speaking 并清理待播放定时器，保证图标不会永久转圈。
    speakSeqRef.current += 1
    window.clearTimeout(pendingSpeakTimerRef.current)
    pendingSpeakTimerRef.current = undefined
    setSpeaking(false)
    const synth = window.speechSynthesis
    if (!synth) return
    try {
      if (synth.speaking || synth.pending) synth.cancel()
    } catch (e) {
      console.error('speechSynthesis.cancel failed', e)
    }
  }, [])

  return {
    speak,
    cancel,
    speaking,
  }
}
