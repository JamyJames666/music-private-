import { useState, useEffect } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let _setState: React.Dispatch<React.SetStateAction<ToastItem[]>> | null = null
let _nextId = 0

export function toast(message: string, type: ToastType = 'success') {
  const id = ++_nextId
  _setState?.(prev => [...prev.slice(-2), { id, message, type }])
  setTimeout(() => {
    _setState?.(prev => prev.filter(t => t.id !== id))
  }, 3000)
}

export function useToastState() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  useEffect(() => {
    _setState = setToasts
    return () => { if (_setState === setToasts) _setState = null }
  }, [])
  return toasts
}
