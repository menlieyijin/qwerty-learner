/** v9.3 仿真专用 React stub：db/index.ts 只在 hook 里用到这些，仿真不调用 hook。 */
export const useCallback = (fn) => fn
export const useContext = () => ({})
export const useMemo = (fn) => fn()
export const useState = (initial) => [typeof initial === 'function' ? initial() : initial, () => {}]
export const useEffect = () => {}
export default {}
