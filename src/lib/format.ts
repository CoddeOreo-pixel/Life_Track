// ============================================================
// 渲染进程通用工具函数
// ============================================================

/** 毫秒 → 可读时长（如 "1h 23m"、"45m"、"12s"） */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

/** 毫秒 → 紧凑时长（如 "1:23:45"、"23:45"） */
export function formatDurationCompact(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 时间戳 → "HH:MM" */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 时间戳 → "HH:MM:SS" */
export function formatTimeSec(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Date → "YYYY-MM-DD"（本地时区） */
export function todayStr(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 日期偏移：返回偏移 n 天的 YYYY-MM-DD */
export function dateOffsetStr(days: number, base = new Date()): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

/** 区间对象 */
export interface DateRange {
  start: string
  end: string
  prevStart: string
  prevEnd: string
}

/** 滚动 7 天周区间：本期 [today-6, today]，上期 [today-13, today-7] */
export function weekRange(base = new Date()): DateRange {
  return {
    start: dateOffsetStr(-6, base),
    end: todayStr(base),
    prevStart: dateOffsetStr(-13, base),
    prevEnd: dateOffsetStr(-7, base)
  }
}

/** 自然月区间：本期 [本月1号, 今天]，上期 [上月1号, 上月末] */
export function monthRange(base = new Date()): DateRange {
  const y = base.getFullYear()
  const m = base.getMonth()
  const firstOfThis = new Date(y, m, 1)
  // 上月最后一天 = 本月1号 - 1天
  const lastOfPrev = new Date(y, m, 0)
  const firstOfPrev = new Date(lastOfPrev.getFullYear(), lastOfPrev.getMonth(), 1)
  return {
    start: todayStr(firstOfThis),
    end: todayStr(base),
    prevStart: todayStr(firstOfPrev),
    prevEnd: todayStr(lastOfPrev)
  }
}

/** YYYY-MM-DD → "MM-DD" 短日期 */
export function shortDate(dateStr: string): string {
  return dateStr.slice(5)
}

/** YYYY-MM-DD → "周X" */
export function weekdayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return labels[d.getDay()]
}

/** 生成 [start, end] 区间内所有 YYYY-MM-DD 日期字符串（含两端） */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = []
  let cur = start
  let guard = 0
  while (cur <= end && guard < 36) {
    out.push(cur)
    cur = dateOffsetStr(1, new Date(cur + 'T00:00:00'))
    guard++
  }
  return out
}

/** 数字千分位 */
export function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 应用类别 → 主题色（野兽主义色板：绿/橙/黑 + 中性灰） */
export function categoryColor(category: string): string {
  switch (category) {
    case 'work':
      return '#00ff88' // 绿
    case 'entertainment':
      return '#ff8800' // 橙
    case 'neutral':
      return '#888888' // 中性灰
    default:
      return '#cccccc'
  }
}

/** 应用类别 → 中文标签 */
export function categoryLabel(category: string): string {
  switch (category) {
    case 'work':
      return '干活'
    case 'entertainment':
      return '摸鱼'
    case 'neutral':
      return '中性'
    default:
      return '其他'
  }
}
