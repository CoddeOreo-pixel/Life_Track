import type { OverviewStats } from '../../electron/preload'
import { formatDuration, formatNumber } from '../lib/format'

// ============================================================
// 总览卡片：今日总时长 / 最常用应用 / 活跃度评分 / 鼠标键盘
// ============================================================

interface Props {
  overview: OverviewStats | null
}

export function OverviewCards({ overview }: Props) {
  if (!overview) {
    return <div className="cards-row">加载中...</div>
  }

  const cards = [
    {
      label: '今日总时长',
      value: formatDuration(overview.total_foreground_ms),
      sub: `${overview.window_switches} 次窗口切换`,
      accent: 'green'
    },
    {
      label: '最常用应用',
      value: overview.top_app_name,
      sub: formatDuration(overview.top_app_ms),
      accent: 'orange'
    },
    {
      label: '活跃度评分',
      value: `${overview.activity_score}`,
      sub: `挂机 ${formatDuration(overview.total_idle_ms)}`,
      accent: 'black'
    },
    {
      label: '鼠标 / 键盘',
      value: `${formatNumber(overview.mouse_click_count)} 次`,
      sub: `移动 ${formatNumber(overview.mouse_move_count)} · 按键 ${formatNumber(overview.key_events)}`,
      accent: 'green'
    }
  ]

  return (
    <div className="cards-row">
      {cards.map((c) => (
        <div key={c.label} className={`card card-${c.accent}`}>
          <div className="card-label">{c.label}</div>
          <div className="card-value">{c.value}</div>
          <div className="card-sub">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}
