'use client'

import { useMemo } from 'react'

// ---------------------------------------------------------------------------
// Lightweight SVG chart components — no recharts dependency.
// Guaranteed to render in any React 19 environment.
// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string
  values: { value: number; color: string; name: string }[]
}

/** Grouped vertical bar chart. */
export function MiniBarChart({ data, height = 260, formatValue }: { data: BarDatum[]; height?: number; formatValue?: (v: number) => string }) {
  const maxVal = useMemo(() => {
    let m = 0
    for (const d of data) for (const v of d.values) m = Math.max(m, v)
    return m || 1
  }, [data])

  if (data.length === 0) return null

  const pad = { top: 8, right: 8, bottom: 24, left: 8 }
  const chartH = height - pad.top - pad.bottom
  const groupW = 100 / data.length
  const barW = Math.min(28, (groupW * 0.7) / (data[0]?.values.length || 1))

  return (
    <div className="w-full" style={{ height }}>
      <svg width="100%" height={height} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="overflow-visible">
        {/* grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={0} x2={100} y1={pad.top + chartH * (1 - p)} y2={pad.top + chartH * (1 - p)} stroke="var(--border)" strokeWidth={0.2} strokeDasharray="1 1" />
        ))}
        {data.map((d, i) => {
          const cx = groupW * i + groupW / 2
          return (
            <g key={i}>
              {d.values.map((v, j) => {
                const barH = (v.value / maxVal) * chartH
                const offset = (j - (d.values.length - 1) / 2) * (barW + 2)
                return (
                  <g key={j}>
                    <rect
                      x={cx + offset - barW / 2}
                      y={pad.top + chartH - barH}
                      width={barW}
                      height={Math.max(0, barH)}
                      fill={v.color}
                      rx={1}
                    >
                      <title>{`${v.name}: ${formatValue ? formatValue(v.value) : v.value}`}</title>
                    </rect>
                  </g>
                )
              })}
              <text x={cx} y={height - 6} textAnchor="middle" fontSize={4} fill="var(--muted-foreground)">
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
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

  // Precompute cumulative offsets without mutation during render
  let acc = 0
  const offsets = data.map((d) => {
    const fraction = d.value / total
    const dash = fraction * circumference
    const start = acc
    acc += dash
    return dash
  })
  // Use a second pass with a functional approach to avoid lint immutability warnings
  const computed = data.reduce(
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
  const segments = computed.segments
  void offsets

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

/** Horizontal bar chart (for wallet distribution, category breakdowns). */
export function MiniHBarChart({ data, height = 260, formatValue }: { data: HBarDatum[]; height?: number; formatValue?: (v: number) => string }) {
  const maxVal = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data])
  if (data.length === 0) return null

  const rowH = Math.min(36, (height - 8) / data.length)
  const gap = 6

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

/** Simple area/line chart using SVG path. */
export function MiniAreaChart({ data, height = 260, color = 'var(--info)', formatValue }: { data: LineDatum[]; height?: number; color?: string; formatValue?: (v: number) => string }) {
  const { maxVal, minVal } = useMemo(() => {
    if (data.length === 0) return { maxVal: 1, minVal: 0 }
    const vals = data.map((d) => d.value)
    return { maxVal: Math.max(...vals, 1), minVal: Math.min(...vals, 0) }
  }, [data])

  if (data.length === 0) return null

  const pad = { top: 8, right: 8, bottom: 20, left: 8 }
  const w = 100
  const chartH = height - pad.top - pad.bottom
  const range = maxVal - minVal || 1
  const stepX = data.length > 1 ? w / (data.length - 1) : 0

  const points = data.map((d, i) => ({
    x: i * stepX,
    y: pad.top + chartH - ((d.value - minVal) / range) * chartH,
    label: d.label,
    value: d.value,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = `${linePath} L ${w} ${pad.top + chartH} L 0 ${pad.top + chartH} Z`

  return (
    <div className="w-full" style={{ height }}>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="overflow-visible">
        <defs>
          <linearGradient id="miniAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={0} x2={w} y1={pad.top + chartH * (1 - p)} y2={pad.top + chartH * (1 - p)} stroke="var(--border)" strokeWidth={0.2} strokeDasharray="1 1" />
        ))}
        <path d={areaPath} fill="url(#miniAreaFill)" stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={0.6} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={0.8} fill={color}>
            <title>{`${p.label}: ${formatValue ? formatValue(p.value) : p.value}`}</title>
          </circle>
        ))}
        {points.filter((_, i) => i % Math.ceil(points.length / 6) === 0).map((p, i) => (
          <text key={i} x={p.x} y={height - 4} textAnchor="middle" fontSize={3} fill="var(--muted-foreground)">
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
