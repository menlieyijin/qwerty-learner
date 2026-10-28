import { KEY_SOUND_URL_PREFIX } from '@/resources/soundResource'
import type { SoundResource } from '@/typings'
import { Howl } from 'howler'

/**
 * 设置面板里的音效试听（AUDIO-006/007）：
 * - 复用单个 Howl，切换音效时先 unload 旧的，避免每次试听都泄漏音频实例；
 * - 遵守调用方传入的音量，不再把 Howler 全局音量强制改成 1（那会覆盖用户/其它模块的音量策略）；
 * - 不再每次 new Howl。
 */
let previewHowl: Howl | null = null
let previewKey = ''

export function playKeySoundResource(soundResource: SoundResource, volume = 1) {
  const path = KEY_SOUND_URL_PREFIX + soundResource.filename
  try {
    if (!previewHowl || previewKey !== path) {
      previewHowl?.unload()
      previewHowl = new Howl({
        src: path,
        format: ['wav'],
      })
      previewKey = path
    }
    previewHowl.volume(Math.min(1, Math.max(0, volume)))
    previewHowl.stop()
    previewHowl.play()
  } catch (e) {
    console.error('play key sound preview failed', e)
  }
}

