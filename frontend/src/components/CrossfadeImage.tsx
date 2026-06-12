import { useState, useEffect, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  src: string
  alt?: string
  className?: string            // wrapper
  style?: CSSProperties         // wrapper
  imgClassName?: string         // applied to both image layers
  imgStyle?: CSSProperties      // applied to both image layers
  duration?: number
}

/**
 * Renders an image that crossfades to the new source when `src` changes,
 * instead of swapping abruptly. The incoming layer only starts fading once
 * it has actually loaded, so there's never a blank frame.
 */
export default function CrossfadeImage({ src, alt = '', className, style, imgClassName, imgStyle, duration = 600 }: Props) {
  const [shown, setShown] = useState(src)
  const [incoming, setIncoming] = useState<string | null>(null)
  const [fadeIn, setFadeIn] = useState(false)

  useEffect(() => {
    if (src === shown) { setIncoming(null); setFadeIn(false); return }
    setIncoming(src)
    setFadeIn(false)
  }, [src, shown])

  useEffect(() => {
    if (!fadeIn || !incoming) return
    const t = setTimeout(() => {
      setShown(incoming)
      setIncoming(null)
      setFadeIn(false)
    }, duration)
    return () => clearTimeout(t)
  }, [fadeIn, incoming, duration])

  const targetOpacity = imgStyle?.opacity ?? 1

  return (
    <div className={cn('relative overflow-hidden', className)} style={style}>
      <img
        src={shown}
        alt={alt}
        className={cn('absolute inset-0 w-full h-full object-cover', imgClassName)}
        style={imgStyle}
      />
      {incoming && (
        <img
          src={incoming}
          alt={alt}
          onLoad={() => requestAnimationFrame(() => setFadeIn(true))}
          onError={() => { setIncoming(null); setFadeIn(false) }}
          className={cn('absolute inset-0 w-full h-full object-cover transition-opacity ease-out', imgClassName)}
          style={{ ...imgStyle, opacity: fadeIn ? targetOpacity : 0, transitionDuration: `${duration}ms` }}
        />
      )}
    </div>
  )
}
