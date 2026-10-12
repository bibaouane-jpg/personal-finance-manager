'use client'

import { useMemo, useState, useEffect, useRef } from 'react'

// ---------------------------------------------------------------------------
// Lightweight chart components — pixel-based, no recharts, React 19 safe.
// ---------------------------------------------------------------------------

// Hook to measure container width for proper SVG scaling.
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

export interface BarDatum {
  label: string
  values: { value: number; color: string; name: string }[]
}

/** Grouped vertical bar chart — CSS-based for reliable rendering. */
export function MiniBarChart({ data, height = 260, formatValue }: { data: BarDatum[]; height?: number; formatValue?: (v: number) => string }) {
  // Compute maxVal inline (no useMemo) to avoid stale closure issues.
  let maxVal = 0
  for (const d of data) for (const v of d.values) maxVal = Math.max(maxVal, v.value)
  if (maxVal === 0) maxVal = 1

  if (data.length === 0) return null

  const labelH = 28
  const chartH = height - labelH - 12

  return (
    <div className="w-full" style={{ height }}>
      {/* grid lines */}
      <div className="relative" style={{ height: chartH }}>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <div
            key={p}
            className="absolute left-0 right-0 border-t border-dashed border-border/60"
            style={{ bottom: `${p * 100}%` }}
          />
        ))}
        {/* bars */}
        <div className="absolute inset-0 flex items-end justify-around gap-1 px-1">
          {data.map((d, i) => (
            <div key={i} className="flex h-full flex-1 items-end justify-center gap-0.5">
              {d.values.map((v, j) => {
                const barH = maxVal > 0 ? (v.value / maxVal) * 100 : 0
                return (
                  <div
                    key={j}
                    className="relative rounded-t transition-all hover:opacity-80"
                    style={{
                      height: `${Math.max(barH, v.value > 0 ? 2 : 0)}%`,
                      backgroundColor: v.color,
                      minWidth: 4,
                      flex: '1 1 0',
                      maxWidth: 32,
                    }}
                    title={`${v.name}: ${formatValue ? formatValue(v.value) : v.value}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {/* labels */}
      <div className="flex justify-around gap-1 px-1 pt-1" style={{ height: labelH }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center">
            <span className="text-[10px] text-muted-foreground truncate inline-block max-w-full">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface DonutDatum {
  name: string
  value: number
  color: string
}

/** Donut chart with center label. */
export function MiniDonutChart({ data, size = 180, thickness = 28, centerLabel, centerValue, formatValue }: { data: DonutDatum[]; size?: number; thickness?: number; centerLabel?: string; centerValue?: string; formatValue?: (v: number) => string }) {
  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data])
  if (data.length === 0 || total === 0) return null

  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r

  // Compute segments functionally to avoid lint immutability warnings.
  const { segments } = data.reduce(
    (state, d, i) => {
      const fraction = d.value / total
      const dash = fraction * circumference
      const segment = (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={d.color}
          strokeWidth={thickness}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeDashoffset={-state.running}
          transform={`rotate(-90 ${cx} ${cy})`}
        >
          <title>{`${d.name}: ${formatValue ? formatValue(d.value) : d.value}`}</title>
        </circle>
      )
      return { running: state.running + dash, segments: [...state.segments, segment] }
    },
    { running: 0, segments: [] as React.ReactNode[] }
  )

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--muted)" strokeWidth={thickness} />
        {segments}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerLabel && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{centerLabel}</span>}
          {centerValue && <span className="text-sm font-semibold tabular-nums">{centerValue}</span>}
        </div>
      )}
    </div>
  )
}

export interface HBarDatum {
  name: string
  value: number
  color: string
}

/** Horizontal bar chart. */
export function MiniHBarChart({ data, height = 260, formatValue }: { data: HBarDatum[]; height?: number; formatValue?: (v: number) => string }) {
  const maxVal = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data])
  if (data.length === 0) return null

  const rowH = Math.min(36, (height - 8) / data.length)

  return (
    <div className="w-full space-y-2" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2" style={{ height: rowH }}>
          <span className="w-24 shrink-0 truncate text-xs text-muted-foreground" title={d.name}>{d.name}</span>
          <div className="relative flex-1 h-full min-h-[20px] rounded bg-muted overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded transition-all"
              style={{ width: `${(d.value / maxVal) * 100}%`, backgroundColor: d.color }}
              title={`${d.name}: ${formatValue ? formatValue(d.value) : d.value}`}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">{formatValue ? formatValue(d.value) : d.value}</span>
        </div>
      ))}
    </div>
  )
}

export interface LineDatum {
  label: string
  value: number
}

/** Area/line chart — pixel-based with measured container width. */
export function MiniAreaChart({ data, height = 260, color = 'var(--info)', formatValue }: { data: LineDatum[]; height?: number; color?: string; formatValue?: (v: number) => string }) {
  const { ref, width } = useContainerWidth<HTMLDivElement>()

  const { maxVal, minVal } = useMemo(() => {
    if (data.length === 0) return { maxVal: 1, minVal: 0 }
    const vals = data.map((d) => d.value)
    return { maxVal: Math.max(...vals, 1), minVal: Math.min(...vals, 0) }
  }, [data])

  const gradientId = useMemo(() => `miniAreaFill-${Math.random().toString(36).slice(2, 9)}`, [])

  if (data.length === 0 || width === 0) {
    return <div ref={ref} className="w-full" style={{ height }} />
  }

  const pad = { top: 12, right: 12, bottom: 24, left: 12 }
  const w = Math.max(width, 200)
  const chartH = height - pad.top - pad.bottom
  const chartW = w - pad.left - pad.right
  const range = maxVal - minVal || 1
  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0

  const points = data.map((d, i) => ({
    x: pad.left + i * stepX,
    y: pad.top + chartH - ((d.value - minVal) / range) * chartH,
    label: d.label,
    value: d.value,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${pad.top + chartH} L ${points[0].x.toFixed(2)} ${pad.top + chartH} Z`

  // Pick which labels to show (every Nth)
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))
  const visibleLabels = points.filter((_, i) => i % labelEvery === 0 || i === points.length - 1)

  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <svg width={w} height={height} className="overflow-visible">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line
            key={p}
            x1={pad.left}
            x2={w - pad.right}
            y1={pad.top + chartH * (1 - p)}
            y2={pad.top + chartH * (1 - p)}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color}>
            <title>{`${p.label}: ${formatValue ? formatValue(p.value) : p.value}`}</title>
          </circle>
        ))}
        {visibleLabels.map((p, i) => (
          <text key={i} x={p.x} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
