import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes, resolving conflicts correctly */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format seconds as m:ss */
export function fmtTime(sec: number): string {
  if (!sec || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format a total-seconds duration as "1h 23m" or "45 min" */
export function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}
