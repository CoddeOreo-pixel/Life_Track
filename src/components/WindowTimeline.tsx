import type { WindowSessionRow } from '../../electron/preload'
import { formatTime, formatDuration, categoryColor } from '../lib/format'

// ============================================================
// 今日窗口切换历史时间线
// ============================================================

interface Props {
  sessions: WindowSessionRow[]
}

export function WindowTimeline({ sessions }: Props) {
  if (!sessions.length) {
    return (
      <div className="panel">
        <h2 className="panel-title">窗口切换时间线</h2>
        <div className="empty">暂无记录</div>
      </div>
    )
  }

  // 时间线条目数量大时虚拟滚动会更优，这里先做最大 200 条截断
  const list = sessions.slice(-200).reverse()

  return (
    <div className="panel">
      <h2 className="panel-title">窗口切换时间线（最近 200 条）</h2>
      <div className="timeline">
        {list.map((s) => (
          <div key={s.id} className="timeline-item">
            <div
              className="timeline-dot"
              style={{ backgroundColor: categoryColor(s.app_category) }}
            />
            <div className="timeline-time">{formatTime(s.start_time)}</div>
            <div className="timeline-content">
              <span className="timeline-app">{s.app_display_name}</span>
              <span className="timeline-title">{s.window_title || '(无标题)'}</span>
            </div>
            <div className="timeline-dur">{formatDuration(s.duration_ms)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
