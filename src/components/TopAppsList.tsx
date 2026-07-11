import type { TopApp } from '../../electron/preload'
import { formatDuration, categoryColor, categoryLabel } from '../lib/format'

// ============================================================
// Top5 应用排行（今日）
// ============================================================

interface Props {
  topApps: TopApp[]
}

export function TopAppsList({ topApps }: Props) {
  if (!topApps.length) {
    return (
      <div className="panel">
        <h2 className="panel-title">今日 TOP 5</h2>
        <div className="empty">暂无数据</div>
      </div>
    )
  }

  // 用总时长计算占比（相对 Top5 之和），而非相对最大值
  const totalMs = topApps.reduce((s, a) => s + a.total_ms, 0)

  return (
    <div className="panel">
      <h2 className="panel-title">今日 TOP 5</h2>
      <ol className="top-list top-list-vertical">
        {topApps.map((app, i) => {
          // 相对总时长的占比，最低 4% 保证可见
          const pct = totalMs > 0
            ? Math.max(4, Math.round((app.total_ms / totalMs) * 100))
            : 4
          return (
            <li key={app.app_display_name} className="top-item">
              <span className="top-rank">{i + 1}</span>
              <div className="top-info">
                <div className="top-name-row">
                  <span className="top-name">{app.app_display_name}</span>
                  <span
                    className="top-cat"
                    style={{
                      color: categoryColor(app.app_category),
                      borderColor: categoryColor(app.app_category)
                    }}
                  >
                    {categoryLabel(app.app_category)}
                  </span>
                  <span className="top-pct">{pct}%</span>
                </div>
                <div className="top-bar-bg">
                  <div
                    className="top-bar-fill"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: categoryColor(app.app_category)
                    }}
                  />
                </div>
              </div>
              <span className="top-duration">
                {formatDuration(app.total_ms)}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
