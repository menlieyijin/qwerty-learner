/**
 * Fisher-Yates 洗牌（返回新数组，不改动入参）。
 *
 * @param rng 可选随机源，默认 `Math.random`。不传时与旧实现完全一致；
 *            传入确定性随机源（如种子 PRNG）可让出题顺序在测试里可复现。
 */
export default function shuffle<T>(array: T[], rng: () => number = Math.random): T[] {
  const length = array == null ? 0 : array.length
  if (!length) {
    return []
  }
  let index = -1
  const lastIndex = length - 1
  const result = Array.from(array)
  while (++index < length) {
    const rand = index + Math.floor(rng() * (lastIndex - index + 1))
    const value = result[rand]
    result[rand] = result[index]
    result[index] = value
  }
  return result
}
