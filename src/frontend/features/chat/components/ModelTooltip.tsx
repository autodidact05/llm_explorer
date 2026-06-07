'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ModelPricing } from '@/lib/types'
import { fmtCtx, fmtRate } from '@/lib/format'

interface TooltipCoords {
  top: number
  left: number
}

export function ModelTooltip({
  above,
  model,
  children,
}: {
  above?: boolean
  model: ModelPricing | null
  children: React.ReactNode
}) {
  const [coords, setCoords] = useState<TooltipCoords | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = useCallback(() => {
    if (!wrapperRef.current || !model) return
    const rect = wrapperRef.current.getBoundingClientRect()
    setCoords(
      above
        ? { top: rect.top, left: rect.left }
        : { top: rect.bottom, left: rect.left },
    )
  }, [above, model])

  const handleMouseLeave = useCallback(() => {
    setCoords(null)
  }, [])

  return (
    <div ref={wrapperRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
      {coords && model &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl min-w-max"
            style={
              above
                ? { bottom: `calc(100vh - ${coords.top}px + 4px)`, left: coords.left }
                : { top: coords.top + 4, left: coords.left }
            }
          >
            <div className="space-y-1">
              {model.category && (
                <div className="flex justify-between gap-6">
                  <span className="text-slate-300">Type</span>
                  <span className="font-mono">{model.category.replace(/->/g, ' → ')}</span>
                </div>
              )}
              <div className="flex justify-between gap-6">
                <span className="text-slate-300">Context Size</span>
                <span className="font-mono">{fmtCtx(model.context_length)}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-slate-300">Input Cost</span>
                <span className="font-mono">{fmtRate(model.input_per_million)}</span>
              </div>
              <div className="flex justify-between gap-6">
                <span className="text-slate-300">Output Cost</span>
                <span className="font-mono">{fmtRate(model.output_per_million)}</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
