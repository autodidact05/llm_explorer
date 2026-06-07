export function getLocalStorage(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  return localStorage.getItem(key) ?? fallback
}

export function setLocalStorage(key: string, value: string | null | undefined) {
  if (typeof window === 'undefined') return
  if (value == null || value === '') localStorage.removeItem(key)
  else localStorage.setItem(key, value)
}

