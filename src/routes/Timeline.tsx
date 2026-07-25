import { useEffect, useState, useMemo } from 'react'
import { WindowTimeline } from '../components/WindowTimeline'
import { todayStr, dateOffsetStr, formatNumber } from '../lib/format'
import type { WindowSessionRow } from '../../electron/preload'

// ============================================================
// 时间线视图：按日期切换的窗口切换历史
// 支持按应用名搜索 + 按分类筛选
// ============================================================

type CategoryFilter = 'all' | 'work' | 'entertainment' | 'neutral'

export default function Timeline() {
  const [date, setDate] = useState<string>(todayStr())
  const [sessions, setSessions] = useState<WindowSessionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterApp, setFilterApp] = useState('')
  const [filterCategory, setFilterCategory] = useState<CategoryFilter>('all')

  // 用 cancelled 标志做竞态保护：date 切换时丢弃旧请求的结果
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.lifeTrack.query
      .windowSessions(date)
      .then((rows) => {
        if (!cancelled) setSessions(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setSessions([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date])

  const goPrev = () => setDate(dateOffsetStr(-1, new Date(date + 'T00:00:00')))
  const goNext = () => {
    const next = dateOffsetStr(1, new Date(date + 'T00:00:00'))
    if (next <= todayStr()) setDate(next)
  }
  const isToday = date === todayStr()

  // 按应用名 + 分类筛选
  const filteredSessions = useMemo(() => {
    if (!filterApp && filterCategory === 'all') return sessions
    const q = filterApp.toLowerCase()
    return sessions.filter((s) => {
      if (filterCategory !== 'all' && s.app_category !== filterCategory) return false
      if (filterApp) {
        if (
          !s.app_display_name.toLowerCase().includes(q) &&
          !s.window_title.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [sessions, filterApp, filterCategory])

  const hasFilter = filterApp !== '' || filterCategory !== 'all'

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">时间线</h1>
        <div className="date-nav">
          <button className="btn-terminal" onClick={goPrev} title="前一天">
            $ prev
          </button>
          <span className="page-date">{date}</span>
          <button
            className="btn-terminal"
            onClick={goNext}
            disabled={isToday}
            title="后一天"
          >
            $ next
          </button>
        </div>
        {loading && <span className="page-loading">加载中...</span>}
      </div>

      {error ? (
        <div className="page-error">加载失败：{error}</div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-header">
              <h2 className="panel-title">窗口切换记录</h2>
              <span className="summary-meta">
                共 {formatNumber(filteredSessions.length)} 次切换
                {hasFilter && `（已筛选，共 ${sessions.length} 条）`}
              </span>
            </div>
            <div className="timeline-filter">
              <input
                className="setting-input timeline-filter-input"
                type="text"
                placeholder="搜索应用名或窗口标题..."
                value={filterApp}
                onChange={(e) => setFilterApp(e.target.value)}
              />
              <select
                className="cat-select"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value as CategoryFilter)}
              >
                <option value="all">全部分类</option>
                <option value="work">干活</option>
                <option value="entertainment">摸鱼</option>
                <option value="neutral">中性</option>
              </select>
              {hasFilter && (
                <button
                  className="btn-terminal"
                  onClick={() => {
                    setFilterApp('')
                    setFilterCategory('all')
                  }}
                >
                  $ clear
                </button>
              )}
            </div>
          </div>
          <WindowTimeline sessions={filteredSessions} />
        </>
      )}
    </div>
  )
}
