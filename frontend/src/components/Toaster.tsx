import { useToastState, type ToastType } from '@/lib/use-toast'

function toastStyle(type: ToastType): React.CSSProperties {
  if (type === 'success') return {
    background: 'rgba(34,197,94,0.15)',
    borderColor: 'rgba(34,197,94,0.3)',
    color: 'rgb(134,239,172)',
  }
  if (type === 'error') return {
    background: 'rgba(244,63,94,0.15)',
    borderColor: 'rgba(244,63,94,0.3)',
    color: 'rgb(253,164,175)',
  }
  return {
    background: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.15)',
    color: '#ccc',
  }
}

export default function Toaster() {
  const toasts = useToastState()

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="animate-fade-up px-4 py-2.5 rounded-xl text-sm font-medium
                     backdrop-blur-md border shadow-lg pointer-events-auto"
          style={toastStyle(t.type)}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}
