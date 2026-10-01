type CachedOrientation = { key: string; data: any }
let current: CachedOrientation | null = null

export const getOrientationCache = () => current
export const setOrientationCache = (next: CachedOrientation) => {
  current = next
}
export const clearOrientationCache = () => {
  current = null
}
