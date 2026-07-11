import { useEffect } from 'react'
import { useTodayStore } from '../stores/today'
import { todayStr } from '../lib/format'
import { OverviewCards } from '../components/OverviewCards'
import { TopAppsList } from '../components/TopAppsList'
import { AppPieChart, HourlyBarChart } from '../components/Charts'
import { WindowTimeline } from '../components/WindowTimeline'
import { TimeTags } from '../components/TimeTags'
import { SummaryCard } from '../components/SummaryCard'

// ============================================================
// 今日视图：总览 + Top5 + 饼图 + 柱状图 + 标签 + 时间线
// ============================================================

export default function TodayPage() {
  const {
    overview,
    topApps,
    hourly,
    sessions,
    tags,
    summary,
    generating,
    summaryError,
    loading,
    error,
    loadAll,
    regenerateSummary
  } = useTodayStore()

  useEffect(() => {
    loadAll(todayStr())
    const t = setInterval(() => loadAll(todayStr()), 30000)
    return () => clearInterval(t)
  }, [loadAll])

  if (error) {
    return <div className="page-error">加载失败：{error}</div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">今日</h1>
        <span className="page-date">{todayStr()}</span>
        {loading && <span className="page-loading">刷新中...</span>}
      </div>

      <OverviewCards overview={overview} />

      <SummaryCard
        summary={summary}
        generating={generating}
        error={summaryError}
        onRegenerate={() => regenerateSummary(todayStr())}
      />

      <TimeTags tags={tags} />

      <div className="grid-2">
        <TopAppsList topApps={topApps} />
        <AppPieChart topApps={topApps} />
      </div>

      <HourlyBarChart hourly={hourly} />

      <WindowTimeline sessions={sessions} />
    </div>
  )
}
