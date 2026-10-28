import { createJSONStorage } from 'jotai/utils'
import type { SyncStorage } from 'jotai/vanilla/utils/atomWithStorage'

/**
 * M6-003（v9.11）：localStorage 的读写保护适配器。
 *
 * jotai 2.1.0 的 `defaultStorage` 在写路径上没有任何 try/catch（`vanilla/utils.js` 的
 * `setItem = storage.setItem(key, JSON.stringify(v))`），localStorage 配额满 / 被浏览器禁用
 * （file:// 、隐私模式）/ 手工改坏时，写配置会抛 QuotaExceededError 并冒泡到 React 事件处理器（白屏）。
 *
 * 这里只包一层 try/catch，**其余语义与默认存储逐字一致**：
 * - 键名不变、`JSON.stringify` / `JSON.parse` 序列化格式不变；
 * - 底层仍是 `createJSONStorage(() => window.localStorage)`，因此保留了跨标签页同步（`subscribe` 的
 *   `storage` 事件）与「首帧仍为 initialValue、在 `onMount` 里读盘」的既有行为（getOnInit 属另一批改动）；
 * - 读失败 / 解析失败 → 返回默认值（与 `createJSONStorage` 自身行为一致）；写失败 → 只告警，内存值照常生效。
 */
export function safeStorage<Value>(): SyncStorage<Value> {
  const jsonStorage = createJSONStorage<Value>(() => window.localStorage)

  return {
    getItem(key, initialValue) {
      try {
        return jsonStorage.getItem(key, initialValue)
      } catch {
        // localStorage 不可访问（SecurityError 等）→ 回退默认值
        return initialValue
      }
    },
    setItem(key, newValue) {
      try {
        jsonStorage.setItem(key, newValue)
      } catch (error) {
        // 配额满 / 存储被禁：只告警不抛，避免冒泡成白屏；本次修改仅在本页内存中生效
        console.warn(`[store] 持久化 "${key}" 失败（localStorage 配额已满或被禁用），本次修改仅在当前页面生效：`, error)
      }
    },
    removeItem(key) {
      try {
        jsonStorage.removeItem(key)
      } catch {
        /* localStorage 不可用时无需处理 */
      }
    },
    subscribe: jsonStorage.subscribe,
  }
}
