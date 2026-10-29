import styles from './index.module.css'
import { SoundSwitchRow } from './sound/SoundSwitchRow'
import { SoundVolumeRow } from './sound/SoundVolumeRow'
import { keySoundResources } from '@/resources/soundResource'
import { hintSoundsConfigAtom, keySoundsConfigAtom, pronunciationConfigAtom } from '@/store'
import type { SoundResource } from '@/typings'
import { playKeySoundResource } from '@/utils/sounds/keySounds'
import { Listbox, Transition } from '@headlessui/react'
import * as ScrollArea from '@radix-ui/react-scroll-area'
import { useAtom } from 'jotai'
import { Fragment, useCallback } from 'react'
import IconCheck from '~icons/tabler/check'
import IconChevronDown from '~icons/tabler/chevron-down'
import IconEar from '~icons/tabler/ear'

/**
 * 音效设置（v10.1 结构整理，dsh）。
 *
 * 拆分前：335 行，11 个 `useCallback`（其中 8 个是「把某个字段改成新值」的同构代码）
 * + 4 个开关 + 5 个滑块的行内 JSX 全挤在一个函数里。
 *
 * 拆分后：
 * - 行级展示抽到 `./sound/SoundSwitchRow`、`./sound/SoundVolumeRow`（DOM 结构与类名逐字保留）；
 * - 开关/滑块的写值统一走 `setPronunciationField` 这类小包装，不再为每个字段各写一个 useCallback；
 * - 本文件只负责「分节 + 装配」，行为不变（开关 aria-label、滑块 aria-label、禁用条件、文案均未改）。
 */
export default function SoundSetting() {
  const [pronunciationConfig, setPronunciationConfig] = useAtom(pronunciationConfigAtom)
  const [keySoundsConfig, setKeySoundsConfig] = useAtom(keySoundsConfigAtom)
  const [hintSoundsConfig, setHintSoundsConfig] = useAtom(hintSoundsConfigAtom)

  // 三个配置的写值包装：语义与原先 8 个同构 useCallback 完全一致（浅合并单字段）
  const setPronunciationField = useCallback(
    <K extends keyof typeof pronunciationConfig>(key: K, value: (typeof pronunciationConfig)[K]) =>
      setPronunciationConfig((prev) => ({ ...prev, [key]: value })),
    [setPronunciationConfig],
  )
  const setKeySoundsField = useCallback(
    <K extends keyof typeof keySoundsConfig>(key: K, value: (typeof keySoundsConfig)[K]) =>
      setKeySoundsConfig((prev) => ({ ...prev, [key]: value })),
    [setKeySoundsConfig],
  )
  const setHintSoundsField = useCallback(
    <K extends keyof typeof hintSoundsConfig>(key: K, value: (typeof hintSoundsConfig)[K]) =>
      setHintSoundsConfig((prev) => ({ ...prev, [key]: value })),
    [setHintSoundsConfig],
  )

  const onChangePronunciationVolume = useCallback(
    (value: [number]) => setPronunciationField('volume', value[0] / 100),
    [setPronunciationField],
  )
  const onChangePronunciationIsTransVolume = useCallback(
    (value: [number]) => setPronunciationField('transVolume', value[0] / 100),
    [setPronunciationField],
  )
  const onChangePronunciationRate = useCallback((value: [number]) => setPronunciationField('rate', value[0]), [setPronunciationField])
  const onChangeKeySoundsVolume = useCallback((value: [number]) => setKeySoundsField('volume', value[0] / 100), [setKeySoundsField])
  const onChangeHintSoundsVolume = useCallback((value: [number]) => setHintSoundsField('volume', value[0] / 100), [setHintSoundsField])

  const onChangeKeySoundsResource = useCallback(
    (key: string) => {
      const soundResource = keySoundResources.find((item: SoundResource) => item.key === key) as SoundResource
      if (!soundResource) return
      setKeySoundsField('resource', soundResource)
    },
    [setKeySoundsField],
  )

  const onPlayKeySound = useCallback(
    (soundResource: SoundResource) => {
      playKeySoundResource(soundResource, keySoundsConfig.volume)
    },
    [keySoundsConfig.volume],
  )

  return (
    <ScrollArea.Root className="flex-1 select-none overflow-y-auto ">
      <ScrollArea.Viewport className="h-full w-full px-3">
        <div className={styles.tabContent}>
          <div className={styles.section}>
            <span className={styles.sectionLabel}>单词发音</span>
            <SoundSwitchRow
              label="单词发音开关"
              checked={pronunciationConfig.isOpen}
              onChange={(checked) => setPronunciationField('isOpen', checked)}
              hint={`发音已${pronunciationConfig.isOpen ? '开启' : '关闭'}`}
            />
            <SoundVolumeRow
              title="音量"
              ariaLabel="单词发音音量"
              value={pronunciationConfig.volume}
              onChange={onChangePronunciationVolume}
              disabled={!pronunciationConfig.isOpen}
            />
            <SoundVolumeRow
              title="倍速"
              ariaLabel="单词发音倍速"
              value={pronunciationConfig.rate ?? 1}
              variant="rate"
              onChange={onChangePronunciationRate}
              disabled={!pronunciationConfig.isOpen}
            />
          </div>
          {window.speechSynthesis && (
            <div className={styles.section}>
              <span className={styles.sectionLabel}>释义发音</span>
              <SoundSwitchRow
                label="释义发音开关"
                checked={pronunciationConfig.isTransRead}
                onChange={(checked) => setPronunciationField('isTransRead', checked)}
                hint={`发音已${pronunciationConfig.isTransRead ? '开启' : '关闭'}`}
              />
              <SoundVolumeRow
                title="音量"
                ariaLabel="释义发音音量"
                value={pronunciationConfig.transVolume}
                onChange={onChangePronunciationIsTransVolume}
              />
            </div>
          )}

          <div className={styles.section}>
            <span className={styles.sectionLabel}>按键音</span>
            <SoundSwitchRow
              label="按键音开关"
              checked={keySoundsConfig.isOpen}
              onChange={(checked) => setKeySoundsField('isOpen', checked)}
              hint={`按键音已${keySoundsConfig.isOpen ? '开启' : '关闭'}`}
            />
            <SoundVolumeRow
              title="音量"
              ariaLabel="按键音音量"
              value={keySoundsConfig.volume}
              min={1}
              onChange={onChangeKeySoundsVolume}
              disabled={!keySoundsConfig.isOpen}
            />
            <div className={`${styles.block}`}>
              <span className={styles.blockLabel}>按键音效</span>
              <Listbox value={keySoundsConfig.resource.key} onChange={onChangeKeySoundsResource}>
                <div className="relative">
                  <Listbox.Button className="listbox-button w-60">
                    <span>{keySoundsConfig.resource.name}</span>
                    <span>
                      <IconChevronDown className="focus:outline-none" />
                    </span>
                  </Listbox.Button>
                  <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
                    <Listbox.Options className="listbox-options z-10">
                      {keySoundResources.map((keySoundResource) => (
                        <Listbox.Option key={keySoundResource.key} value={keySoundResource.key}>
                          {({ selected }) => (
                            <>
                              <div className="group flex cursor-pointer items-center justify-between">
                                <span>{keySoundResource.name}</span>
                                {selected ? (
                                  <span className="listbox-options-icon">
                                    <IconCheck className="focus:outline-none" />
                                  </span>
                                ) : null}
                                <IconEar
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onPlayKeySound(keySoundResource)
                                  }}
                                  className="mr-2  hidden cursor-pointer text-neutral-500 hover:text-indigo-400 group-hover:block dark:text-neutral-300"
                                />
                              </div>
                            </>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </Transition>
                </div>
              </Listbox>
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>效果音</span>
            <SoundSwitchRow
              label="效果音开关"
              checked={hintSoundsConfig.isOpen}
              onChange={(checked) => setHintSoundsField('isOpen', checked)}
              hint={`效果音已${hintSoundsConfig.isOpen ? '开启' : '关闭'}`}
            />
            <SoundVolumeRow
              title="音量"
              ariaLabel="效果音音量"
              value={hintSoundsConfig.volume}
              min={1}
              onChange={onChangeHintSoundsVolume}
              disabled={!hintSoundsConfig.isOpen}
            />
          </div>
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar className="flex touch-none select-none bg-transparent " orientation="vertical"></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  )
}
