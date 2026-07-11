import type { DailyTags, TagKey } from '../../electron/preload'
import { TAG_DEFS } from '../../electron/shared/types'

// ============================================================
// 时段标签展示
// ============================================================

interface Props {
  tags: DailyTags | null
}

export function TimeTags({ tags }: Props) {
  if (!tags) {
    return (
      <div className="panel">
        <h2 className="panel-title">今日时段标签</h2>
        <div className="empty">暂无标签数据</div>
      </div>
    )
  }

  // 只展示有命中的标签（值 > 0 分钟）
  const activeTags = TAG_DEFS.filter(
    (t) => (tags[t.key as TagKey] as number) > 0
  )

  return (
    <div className="panel">
      <h2 className="panel-title">今日时段标签</h2>
      {activeTags.length === 0 ? (
        <div className="empty">今天还没有命中任何标签</div>
      ) : (
        <div className="tags-grid">
          {activeTags.map((t) => {
            const minutes = tags[t.key as TagKey] as number
            return (
              <div
                key={t.key}
                className="tag-item"
                style={{ borderLeftColor: t.color }}
              >
                <div className="tag-label" style={{ color: t.color }}>
                  {t.label}
                </div>
                <div className="tag-desc">{t.desc}</div>
                <div className="tag-value">{minutes} 分钟</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
