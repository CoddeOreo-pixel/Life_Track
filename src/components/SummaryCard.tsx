import type { DailySummary } from '../../electron/preload'
import { formatTime } from '../lib/format'

// ============================================================
// AI 灵魂总结卡片
// ============================================================

interface Props {
  summary: DailySummary | null
  generating: boolean
  error: string | null
  onRegenerate: () => void
}

export function SummaryCard({ summary, generating, error, onRegenerate }: Props) {
  return (
    <div className="panel summary-card">
      <div className="panel-header">
        <h2 className="panel-title">今日灵魂总结</h2>
        <button
          className="btn-terminal"
          onClick={onRegenerate}
          disabled={generating}
          title="重新生成 AI 总结"
        >
          {generating ? '$ gen...' : '$ gen'}
        </button>
      </div>

      {error && <div className="summary-error">{error}</div>}

      {generating && !summary ? (
        <div className="summary-loading">AI 正在为你写总结...</div>
      ) : summary ? (
        <>
          <p className="summary-text">{summary.summary_text}</p>
          <div className="summary-meta">
            <span>{formatTime(summary.generated_at)}</span>
            {summary.model && <span className="summary-model">{summary.model}</span>}
            {summary.is_manual === 1 && <span className="summary-badge">手动</span>}
            {summary.is_manual === 0 && <span className="summary-badge auto">自动</span>}
          </div>
        </>
      ) : (
        <div className="empty">
          还没有灵魂总结。点击右上角 <code>$ gen</code> 让 AI 帮你写一段，或等到设定时间自动生成。
        </div>
      )}
    </div>
  )
}
