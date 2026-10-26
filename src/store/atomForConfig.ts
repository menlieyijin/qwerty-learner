import type { WritableAtom } from 'jotai'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { RESET } from 'jotai/vanilla/utils/constants'

type SetStateActionWithReset<Value> = Value | typeof RESET | ((prev: Value) => Value | typeof RESET)

export default function atomForConfig<T extends Record<string, unknown>>(
  key: string,
  defaultValue: T,
): WritableAtom<T, [SetStateActionWithReset<T>], void> {
  const storageAtom = atomWithStorage(key, defaultValue)
  return atom((get) => {
    // Get the underlying object
    const config = get(storageAtom) as unknown

    // L-01：localStorage 里可能是 null / 数组 / 类型不符（历史版本、手工改坏、被其它脚本覆盖），
    // 旧实现只比较 typeof（null 与数组都是 'object'），随后 `key in config` 会抛 TypeError 或展开出脏字段。
    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)

    const defaultConfig = defaultValue as Record<string, unknown>
    let newConfig: T
    let needPersist = false

    if (!isPlainObject(config)) {
      // null / 数组 / 原始值 / undefined → 整体回退默认值
      newConfig = defaultValue
      needPersist = true
    } else {
      const merged: Record<string, unknown> = { ...defaultConfig }
      for (const configKey of Object.keys(defaultConfig)) {
        const currentValue = config[configKey]
        const defaultValueItem = defaultConfig[configKey]
        // 缺失、null 或类型不符的字段回退到默认值（避免脏配置进入业务逻辑）
        if (currentValue === undefined || currentValue === null || typeof currentValue !== typeof defaultValueItem) {
          needPersist = true
          continue
        }
        merged[configKey] = currentValue
      }
      // 多余字段或字段值变化时也写回，保持 localStorage 与默认结构一致
      if (!needPersist) {
        const configKeys = Object.keys(config)
        needPersist =
          configKeys.length !== Object.keys(merged).length ||
          Object.keys(merged).some((mergedKey) => config[mergedKey] !== merged[mergedKey])
      }
      newConfig = merged as T
    }

    if (needPersist) {
      try {
        localStorage.setItem(key, JSON.stringify(newConfig))
      } catch (error) {
        // localStorage 不可用（file:// / 隐私模式 / 配额满）时不应让 atom 读取崩溃
        console.warn(`[atomForConfig] 持久化配置 "${key}" 失败：`, error)
      }
    }

    return newConfig
  }, storageAtom.write)
}
