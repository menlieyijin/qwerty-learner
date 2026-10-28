import type { Dictionary } from '@/typings'

/**
 * 按 key 分组。
 *
 * M6-011：累加器改用无原型对象（`Object.create(null)`）。原先用 `{}` 时，
 * 若分组键是 `'__proto__'`，`result['__proto__'] = [value]` 会命中 `Object.prototype` 上的
 * setter 从而**改写原型而不是新增键** → 该组数据静默丢失。
 * 无原型对象上 `__proto__` 只是普通自有属性，分组行为正确；键顺序、`Object.keys` /
 * `Object.entries` / 展开 / `JSON.stringify` 的结果与普通对象一致，返回类型不变。
 */
export default function groupBy<T>(elements: T[], iteratee: (value: T) => string) {
  return elements.reduce<Record<string, T[]>>((result, value) => {
    const key = iteratee(value)
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key].push(value)
    } else {
      result[key] = [value]
    }
    return result
  }, Object.create(null) as Record<string, T[]>)
}

export function groupByDictTags(dicts: Dictionary[]) {
  // 同上：tag 来自词库数据，用无原型对象避免 `__proto__` 之类键丢分组
  return dicts.reduce<Record<string, Dictionary[]>>((result, dict) => {
    dict.tags.forEach((tag) => {
      if (Object.prototype.hasOwnProperty.call(result, tag)) {
        result[tag].push(dict)
      } else {
        result[tag] = [dict]
      }
    })
    return result
  }, Object.create(null) as Record<string, Dictionary[]>)
}
