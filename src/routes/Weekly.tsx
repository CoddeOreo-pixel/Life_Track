import { useEffect, useMemo, useState } from 'react'
import { useRangeStore } from '../stores/range'
import {
  weekRange,
  eachDate,
  shortDate,
  weekdayLabel,
  formatDuration,
  categoryColor,
  categoryLabel
} from '../lib/format'
import { Chart } from '../components/Chart'
import type { DailyActivity, TopApp } from '../../electron/preload'

// ============================================================
// 周报视图：折线趋势 + 活跃/挂机柱状图 + Top10 + 同期对比
// ============================================================

/** 把 DailyActivity[] 按 date 建索引 */
function indexByDate(rows: DailyActivity[]): Map<string, DailyActivity> {
  const m = new Map<string, DailyActivity>()
  for (const r of rows) m.set(r.date, r)
  return m
}

/** 求和一个区间的活跃时长 */
function sumActive(rows: DailyActivity[]): number {
  return rows.reduce((s, r) => s + r.active_ms, 0)
}

/** 变化百分比：正向返回 +x%，负向 -x%，无基数返回 null */
function diffPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export default function Weekly() {
  const {
    daily,
    topApps,
    prevDaily,
    prevTopApps,
    prevStart,
    prevEnd,
    loading,
    error,
    loadRange
  } = useRangeStore()

  // range 依赖 today 字符串，跨午夜后用户切回页面时重新计算
  const [today, setToday] = useState(() => new Date().toDateString())
  const range = useMemo(() => weekRange(), [today])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setToday(new Date().toDateString())
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    loadRange(range.start, range.end, range.prevStart, range.prevEnd)
  }, [loadRange, range])

  // 补齐本期 7 天序列
  const dates = useMemo(() => eachDate(range.start, range.end), [range])
  const curMap = useMemo(() => indexByDate(daily), [daily])
  const prevDates = useMemo(() => eachDate(range.prevStart, range.prevEnd), [range])
  const prevMap = useMemo(() => indexByDate(prevDaily), [prevDaily])

  const curTotal = sumActive(daily)
  const prevTotal = sumActive(prevDaily)
  const totalDiff = diffPct(curTotal, prevTotal)

  // 折线图：每日活跃时长（本期 vs 上期）
  const lineOption = useMemo(() => {
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['本期', '上期'], textStyle: { color: '#888' }, top: 0 },
      grid: { left: 50, right: 20, top: 36, bottom: 28 },
      xAxis: {
        type: 'category',
        data: dates.map((d) => `${shortDate(d)} ${weekdayLabel(d)}`),
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#333' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#888',
          fontSize: 11,
          formatter: (v: number) => formatDuration(v)
        },
        splitLine: { lineStyle: { color: '#1e1e1e' } }
      },
      series: [
        {
          name: '本期',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: dates.map((d) => curMap.get(d)?.active_ms ?? 0),
          lineStyle: { color: '#22c55e', width: 2 },
          itemStyle: { color: '#22c55e' },
          areaStyle: { color: 'rgba(34,197,94,0.12)' }
        },
        {
          name: '上期',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          data: prevDates.map((d) => prevMap.get(d)?.active_ms ?? 0),
          lineStyle: { color: '#ff6b00', width: 2, type: 'dashed' },
          itemStyle: { color: '#ff6b00' }
        }
      ]
    }
  }, [dates, curMap, prevDates, prevMap])

  // 柱状图：每日活跃/挂机堆叠
  const barOption = useMemo(() => {
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['活跃', '挂机'], textStyle: { color: '#888' }, top: 0 },
      grid: { left: 50, right: 20, top: 36, bottom: 28 },
      xAxis: {
        type: 'category',
        data: dates.map((d) => `${shortDate(d)} ${weekdayLabel(d)}`),
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#333' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#888',
          fontSize: 11,
          formatter: (v: number) => formatDuration(v)
        },
        splitLine: { lineStyle: { color: '#1e1e1e' } }
      },
      series: [
        {
          name: '活跃',
          type: 'bar',
          stack: 'total',
          data: dates.map((d) => curMap.get(d)?.active_ms ?? 0),
          itemStyle: { color: '#22c55e' },
          barMaxWidth: 32
        },
        {
          name: '挂机',
          type: 'bar',
          stack: 'total',
          data: dates.map((d) => curMap.get(d)?.idle_ms ?? 0),
          itemStyle: { color: '#ff6b00', opacity: 0.5 },
          barMaxWidth: 32
        }
      ]
    }
  }, [dates, curMap])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">周报</h1>
        <span className="page-date">
          {range.start} ~ {range.end}
        </span>
        {loading && <span className="page-loading">刷新中...</span>}
      </div>

      {error && <div className="page-error">加载失败：{error}</div>}

      {/* 同期对比卡片 */}
      <div className="card-grid card-grid-3">
        <CompareCard
          label="本期总活跃"
          value={formatDuration(curTotal)}
          diff={totalDiff}
        />
        <CompareCard
          label="上期总活跃"
          value={formatDuration(prevTotal)}
          diff={null}
          sub={`${range.prevStart} ~ ${range.prevEnd}`}
        />
        <CompareCard
          label="本期日均活跃"
          value={formatDuration(dates.length > 0 ? Math.floor(curTotal / dates.length) : 0)}
          diff={diffPct(
            dates.length > 0 ? curTotal / dates.length : 0,
            prevDates.length > 0 ? prevTotal / prevDates.length : 0
          )}
        />
      </div>

      <div className="panel">
        <h2 className="panel-title">活跃时长趋势</h2>
        <Chart option={lineOption} height={300} />
      </div>

      <div className="panel">
        <h2 className="panel-title">活跃 / 挂机分布</h2>
        <Chart option={barOption} height={280} />
      </div>

      <TopAppsPanel topApps={topApps} prevTopApps={prevTopApps} />
    </div>
  )
}

/** 同期对比卡片 */
function CompareCard({
  label,
  value,
  diff,
  sub
}: {
  label: string
  value: string
  diff: number | null
  sub?: string
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
      {diff !== null && (
        <div className={diff >= 0 ? 'card-diff up' : 'card-diff down'}>
          {diff >= 0 ? '+' : ''}
          {diff}% 较上期
        </div>
      )}
    </div>
  )
}

/** Top 应用面板 */
function TopAppsPanel({ topApps, prevTopApps }: { topApps: TopApp[]; prevTopApps: TopApp[] }) {
  const prevMap = new Map(prevTopApps.map((a) => [a.app_display_name, a.total_ms]))
  return (
    <div className="panel">
      <h2 className="panel-title">本期 Top 应用</h2>
      {topApps.length === 0 ? (
        <div className="empty">本周还没有数据</div>
      ) : (
        <div className="top-list">
          {topApps.map((a, i) => {
            const prev = prevMap.get(a.app_display_name)
            const d = prev !== undefined ? diffPct(a.total_ms, prev) : null
            return (
              <div key={a.app_display_name} className="top-row">
                <span className="top-rank">{i + 1}</span>
                <span
                  className="top-dot"
                  style={{ backgroundColor: categoryColor(a.app_category) }}
                />
                <span className="top-name">{a.app_display_name}</span>
                <span className="top-cat">{categoryLabel(a.app_category)}</span>
                <span className="top-ms">{formatDuration(a.total_ms)}</span>
                {d !== null && (
                  <span className={d >= 0 ? 'top-diff up' : 'top-diff down'}>
                    {d >= 0 ? '+' : ''}
                    {d}%
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
