import { useEffect, useMemo, useState } from 'react'
import { useRangeStore } from '../stores/range'
import {
  monthRange,
  eachDate,
  formatDuration,
  categoryColor,
  categoryLabel
} from '../lib/format'
import { Chart } from '../components/Chart'
import type { DailyActivity, TopApp } from '../../electron/preload'

// ============================================================
// 月报视图：日活跃度热力图 + 月度统计 + Top10 + 同期对比
// ============================================================

/** 解析 YYYY-MM-DD 的年/月/日 */
function parseYmd(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m: m - 1, d }
}

/** 周几（周一=0 ... 周日=6，中国习惯） */
function weekdayMonFirst(s: string): number {
  const { y, m, d } = parseYmd(s)
  return (new Date(y, m, d).getDay() + 6) % 7
}

function sumActive(rows: DailyActivity[]): number {
  return rows.reduce((s, r) => s + r.active_ms, 0)
}

function diffPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export default function Monthly() {
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
  const range = useMemo(() => monthRange(), [today])

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

  const dates = useMemo(() => eachDate(range.start, range.end), [range])
  const curMap = useMemo(() => {
    const m = new Map<string, DailyActivity>()
    for (const r of daily) m.set(r.date, r)
    return m
  }, [daily])

  const curTotal = sumActive(daily)
  const prevTotal = sumActive(prevDaily)
  const totalDiff = diffPct(curTotal, prevTotal)
  const activeDays = daily.filter((r) => r.active_ms > 0).length

  // 热力图数据：[weekIndex, weekday, value]
  const heatData = useMemo(() => {
    const arr: [number, number, number][] = []
    let maxWeek = 0
    // 本月 1 号的周几（周一=0），整个月恒定，提到循环外计算一次
    const firstDs = dates[0]
    const firstParsed = firstDs ? parseYmd(firstDs) : null
    const firstWeekday = firstParsed
      ? (new Date(firstParsed.y, firstParsed.m, 1).getDay() + 6) % 7
      : 0
    for (const ds of dates) {
      const { d } = parseYmd(ds)
      const weekIdx = Math.floor((d - 1 + firstWeekday) / 7)
      const wd = weekdayMonFirst(ds)
      const val = curMap.get(ds)?.active_ms ?? 0
      arr.push([weekIdx, wd, val])
      if (weekIdx > maxWeek) maxWeek = weekIdx
    }
    return { arr, weekCount: maxWeek + 1 }
  }, [dates, curMap])

  const maxActive = useMemo(
    () => Math.max(1, ...heatData.arr.map((x) => x[2])),
    [heatData]
  )

  const heatOption = useMemo(() => {
    const weekLabels = Array.from({ length: heatData.weekCount }, (_, i) => `第${i + 1}周`)
    // 日期 → 活跃时长映射，用于 tooltip 显示具体日期
    const dateMap = new Map<string, string>()
    const firstDs = dates[0]
    const firstParsed = firstDs ? parseYmd(firstDs) : null
    const firstWeekday = firstParsed
      ? (new Date(firstParsed.y, firstParsed.m, 1).getDay() + 6) % 7
      : 0
    for (const ds of dates) {
      const { d } = parseYmd(ds)
      const weekIdx = Math.floor((d - 1 + firstWeekday) / 7)
      const wd = weekdayMonFirst(ds)
      dateMap.set(`${weekIdx},${wd}`, ds)
    }
    return {
      tooltip: {
        formatter: (p: unknown) => {
          const data = (p as { data: [number, number, number] }).data
          const v = data[2]
          const key = `${data[0]},${data[1]}`
          const ds = dateMap.get(key) || ''
          return `${ds}<br/>活跃 ${formatDuration(v)}`
        }
      },
      grid: { left: 50, right: 20, top: 16, bottom: 48 },
      xAxis: {
        type: 'category',
        data: weekLabels,
        splitArea: { show: false },
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#333' } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'category',
        data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
        splitArea: { show: false },
        axisLabel: { color: '#888', fontSize: 11 },
        axisLine: { lineStyle: { color: '#333' } },
        axisTick: { show: false }
      },
      visualMap: {
        min: 0,
        max: maxActive,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 4,
        textStyle: { color: '#888', fontSize: 10 },
        inRange: { color: ['#161616', '#166534', '#22c55e', '#86efac'] }
      },
      series: [
        {
          type: 'heatmap',
          data: heatData.arr,
          label: { show: false },
          itemStyle: {
            borderRadius: 3,
            borderColor: '#0a0a0a',
            borderWidth: 2
          },
          emphasis: {
            itemStyle: { borderColor: '#fff', borderWidth: 1 }
          }
        }
      ]
    }
  }, [heatData, maxActive, dates])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">月报</h1>
        <span className="page-date">
          {range.start} ~ {range.end}
        </span>
        {loading && <span className="page-loading">刷新中...</span>}
      </div>

      {error && <div className="page-error">加载失败：{error}</div>}

      <div className="card-grid card-grid-4">
        <StatCard label="本月总活跃" value={formatDuration(curTotal)} />
        <StatCard
          label="较上月"
          value={totalDiff === null ? '--' : `${totalDiff >= 0 ? '+' : ''}${totalDiff}%`}
          tone={totalDiff === null ? 'neutral' : totalDiff >= 0 ? 'up' : 'down'}
        />
        <StatCard label="活跃天数" value={`${activeDays} / ${dates.length}`} />
        <StatCard
          label="日均活跃"
          value={formatDuration(dates.length > 0 ? Math.floor(curTotal / dates.length) : 0)}
        />
      </div>

      <div className="panel">
        <h2 className="panel-title">日活跃度热力图</h2>
        <Chart option={heatOption} height={240} />
      </div>

      <MonthTopApps topApps={topApps} prevTopApps={prevTopApps} prevRange={`${prevStart} ~ ${prevEnd}`} />
    </div>
  )
}

function StatCard({
  label,
  value,
  tone = 'neutral'
}: {
  label: string
  value: string
  tone?: 'neutral' | 'up' | 'down'
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div
        className="card-value"
        style={
          tone === 'up'
            ? { color: '#22c55e' }
            : tone === 'down'
              ? { color: '#ff6b00' }
              : undefined
        }
      >
        {value}
      </div>
    </div>
  )
}

function MonthTopApps({
  topApps,
  prevTopApps,
  prevRange
}: {
  topApps: TopApp[]
  prevTopApps: TopApp[]
  prevRange: string
}) {
  const prevMap = new Map(prevTopApps.map((a) => [a.app_display_name, a.total_ms]))
  return (
    <div className="panel">
      <h2 className="panel-title">本月 Top 应用</h2>
      {topApps.length === 0 ? (
        <div className="empty">本月还没有数据</div>
      ) : (
        <>
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
          <div className="card-sub" style={{ marginTop: 12 }}>
            上月对比区间：{prevRange}
          </div>
        </>
      )}
    </div>
  )
}
