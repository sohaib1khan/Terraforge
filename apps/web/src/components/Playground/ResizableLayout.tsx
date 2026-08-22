import { useCallback, useEffect, useRef, useState } from 'react'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function readStored(key: string, fallback: number) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* ignore */
  }
}

type SplitProps = {
  storageKey: string
  initial: number
  min?: number
  max?: number
  className?: string
  /** Accessible label for the drag handle */
  handleLabel?: string
  first: React.ReactNode
  second: React.ReactNode
}

/**
 * Side-by-side panes. First pane width is a percent of the container.
 * Below 1280px, stacks vertically and first pane height is in pixels.
 */
export function HorizontalSplit({
  storageKey,
  initial,
  min = 28,
  max = 72,
  className = '',
  handleLabel = 'Drag to resize',
  first,
  second,
}: SplitProps) {
  const [pct, setPct] = useState(() => clamp(readStored(storageKey, initial), min, max))
  const [stackPx, setStackPx] = useState(() =>
    clamp(readStored(`${storageKey}-stack`, 320), 180, 800),
  )
  const [stacked, setStacked] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches,
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const stackedRef = useRef(stacked)
  stackedRef.current = stacked
  const draggingRef = useRef(false)

  useEffect(() => {
    writeStored(storageKey, pct)
  }, [storageKey, pct])

  useEffect(() => {
    writeStored(`${storageKey}-stack`, stackPx)
  }, [storageKey, stackPx])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const sync = () => setStacked(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      draggingRef.current = true
      document.body.classList.add('playground-resizing')
      document.body.style.cursor = stackedRef.current ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return
        const wrap = wrapRef.current
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        if (rect.width < 8 || rect.height < 8) return
        if (stackedRef.current) {
          const next = ev.clientY - rect.top
          setStackPx(clamp(next, 160, Math.max(160, rect.height - 120)))
        } else {
          const next = ((ev.clientX - rect.left) / rect.width) * 100
          setPct(clamp(next, min, max))
        }
      }

      const onUp = (ev: PointerEvent) => {
        draggingRef.current = false
        try {
          handle.releasePointerCapture(ev.pointerId)
        } catch {
          /* already released */
        }
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        document.body.classList.remove('playground-resizing')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [max, min],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = e.shiftKey ? 5 : 2
      if (stacked) {
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setStackPx((v) => clamp(v - 24, 160, 800))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setStackPx((v) => clamp(v + 24, 160, 800))
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPct((v) => clamp(v - step, min, max))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPct((v) => clamp(v + step, min, max))
      }
    },
    [max, min, stacked],
  )

  return (
    <div
      ref={wrapRef}
      className={`playground-hsplit ${stacked ? 'playground-hsplit-stacked' : ''} ${className}`}
      style={
        stacked
          ? {
              gridTemplateColumns: 'minmax(0, 1fr)',
              gridTemplateRows: `${stackPx}px 14px minmax(10rem, 1fr)`,
            }
          : {
              gridTemplateColumns: `minmax(0, ${pct}fr) 14px minmax(0, ${100 - pct}fr)`,
            }
      }
    >
      <div className="playground-pane playground-hsplit-first">{first}</div>
      <button
        type="button"
        aria-label={handleLabel}
        title={handleLabel}
        className={`playground-split-handle ${stacked ? 'playground-split-handle-y' : 'playground-split-handle-x'}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className="playground-pane playground-hsplit-second">{second}</div>
    </div>
  )
}

/** Stacked panes. First pane height is pixels. */
export function VerticalSplit({
  storageKey,
  initial,
  min = 200,
  max = 900,
  className = '',
  handleLabel = 'Drag to resize',
  first,
  second,
}: SplitProps) {
  const [px, setPx] = useState(() => clamp(readStored(storageKey, initial), min, max))
  const wrapRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  useEffect(() => {
    writeStored(storageKey, px)
  }, [storageKey, px])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      draggingRef.current = true
      document.body.classList.add('playground-resizing')
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return
        const wrap = wrapRef.current
        if (!wrap) return
        const rect = wrap.getBoundingClientRect()
        if (rect.height < 8) return
        const next = ev.clientY - rect.top
        const cap = Math.min(max, Math.max(min, rect.height - 140))
        setPx(clamp(next, min, cap))
      }

      const onUp = (ev: PointerEvent) => {
        draggingRef.current = false
        try {
          handle.releasePointerCapture(ev.pointerId)
        } catch {
          /* already released */
        }
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        document.body.classList.remove('playground-resizing')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [max, min],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = e.shiftKey ? 48 : 24
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPx((v) => clamp(v - step, min, max))
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPx((v) => clamp(v + step, min, max))
      }
    },
    [max, min],
  )

  return (
    <div
      ref={wrapRef}
      className={`playground-vsplit ${className}`}
      style={{ gridTemplateRows: `${px}px 14px minmax(10rem, 1fr)` }}
    >
      <div className="playground-pane playground-vsplit-first">{first}</div>
      <button
        type="button"
        aria-label={handleLabel}
        title={handleLabel}
        className="playground-split-handle playground-split-handle-y"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className="playground-pane playground-vsplit-second">{second}</div>
    </div>
  )
}
