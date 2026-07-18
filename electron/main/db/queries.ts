import { getDb } from './index'
import type {
  TopApp,
  OverviewStats,
  HourlyActivity,
  WindowSessionRow,
  MinuteActivity,
  DailyActivity
} from '../../shared/types'

// ============================================================
// 数据查询层 —— 所有读取聚合查询集中在此
// 返回纯 JS 对象，供 IPC handler 序列化传给渲染进程
// ============================================================

/** 工具：执行查询返回对象数组（带 try/finally 保证 free） */
function all<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql)
  try {
    stmt.bind(params)
    const rows: T[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T)
    }
    return rows
  } finally {
    stmt.free()
  }
}

/** 工具：执行查询返回单行 */
function get<T>(sql: string, params: unknown[] = []): T | null {
  const stmt = getDb().prepare(sql)
  try {
    stmt.bind(params)
    if (stmt.step()) {
      return stmt.getAsObject() as T
    }
    return null
  } finally {
    stmt.free()
  }
}

/** 今日 Top N 应用 */
export function getTopApps(date: string, limit = 5): TopApp[] {
  return all<TopApp>(
    `SELECT app_display_name, app_category, SUM(duration_ms) AS total_ms
     FROM window_sessions
     WHERE date = ?
     GROUP BY app_display_name, app_category
     ORDER BY total_ms DESC
     LIMIT ?`,
    [date, limit]
  )
}

/** 今日总览统计（2 次查询替代原 4 次子查询，减少索引扫描） */
export function getOverview(date: string): OverviewStats {
  // 查询1：前台总时长 + 窗口切换次数（一次扫描 idx_window_date）
  const sumRow = get<{ total: number; switches: number }>(
    `SELECT
       COALESCE(SUM(duration_ms), 0) AS total,
       COUNT(*) AS switches
     FROM window_sessions WHERE date = ?`,
    [date]
  )

  // 查询2：Top 应用名 + 时长（一次扫描 + GROUP BY，避免原 SQL 的 3 次冗余子查询）
  const topRow = get<{ top_name: string; top_ms: number }>(
    `SELECT app_display_name AS top_name, SUM(duration_ms) AS top_ms
     FROM window_sessions WHERE date = ?
     GROUP BY app_display_name
     ORDER BY top_ms DESC
     LIMIT 1`,
    [date]
  )

  // 查询3：活跃/挂机时长 + 鼠标键盘事件（activity_log 表，独立索引）
  const actRow = get<{
    active_ms: number
    idle_ms: number
    mouse_move: number
    mouse_click: number
    keys: number
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN is_active = 1 THEN 60000 ELSE 0 END), 0) AS active_ms,
       COALESCE(SUM(CASE WHEN is_active = 0 THEN 60000 ELSE 0 END), 0) AS idle_ms,
       COALESCE(SUM(mouse_move_count), 0) AS mouse_move,
       COALESCE(SUM(mouse_click_count), 0) AS mouse_click,
       COALESCE(SUM(key_count), 0) AS keys
     FROM activity_log WHERE date = ?`,
    [date]
  )

  const activeMs = actRow?.active_ms ?? 0
  const idleMs = actRow?.idle_ms ?? 0
  const totalMs = activeMs + idleMs
  const score = totalMs > 0 ? Math.round((activeMs / totalMs) * 100) : 0

  return {
    total_foreground_ms: sumRow?.total ?? 0,
    total_active_ms: activeMs,
    total_idle_ms: idleMs,
    window_switches: sumRow?.switches ?? 0,
    top_app_name: topRow?.top_name ?? '--',
    top_app_ms: topRow?.top_ms ?? 0,
    mouse_move_count: actRow?.mouse_move ?? 0,
    mouse_click_count: actRow?.mouse_click ?? 0,
    key_events: actRow?.keys ?? 0,
    activity_score: score
  }
}

/** 按小时聚合活跃度（0-23，本地时区） */
export function getHourlyActivity(date: string): HourlyActivity[] {
  // 使用 strftime + localtime 将毫秒时间戳转为本地小时
  const rows = all<{ hour: number; active_ms: number; idle_ms: number }>(
    `SELECT
       CAST(strftime('%H', minute_start / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
       SUM(CASE WHEN is_active = 1 THEN 60000 ELSE 0 END) AS active_ms,
       SUM(CASE WHEN is_active = 0 THEN 60000 ELSE 0 END) AS idle_ms
     FROM activity_log WHERE date = ?
     GROUP BY hour
     ORDER BY hour`,
    [date]
  )
  // 补齐 0-23 全部小时
  const map = new Map(rows.map((r) => [r.hour, r]))
  const result: HourlyActivity[] = []
  for (let h = 0; h < 24; h++) {
    const r = map.get(h)
    result.push({
      hour: h,
      active_ms: r?.active_ms ?? 0,
      idle_ms: r?.idle_ms ?? 0
    })
  }
  return result
}

/** 今日窗口切换历史 */
export function getWindowSessions(date: string): WindowSessionRow[] {
  return all<WindowSessionRow>(
    `SELECT id, app_display_name, app_category, process_name, window_title,
            start_time, end_time, duration_ms
     FROM window_sessions WHERE date = ?
     ORDER BY start_time ASC`,
    [date]
  )
}

/** 按分钟获取活跃度（时间线/标签用） */
export function getMinuteActivity(date: string): MinuteActivity[] {
  return all<MinuteActivity>(
    `SELECT minute_start, is_active, mouse_move_count, mouse_click_count,
            key_count, foreground_process
     FROM activity_log WHERE date = ?
     ORDER BY minute_start ASC`,
    [date]
  )
}

/** 指定日期区间内每天的活跃度统计（周报月报用） */
export function getDailyActivityRange(
  startDate: string,
  endDate: string
): DailyActivity[] {
  return all<DailyActivity>(
    `SELECT
       date,
       SUM(CASE WHEN is_active = 1 THEN 60000 ELSE 0 END) AS active_ms,
       SUM(CASE WHEN is_active = 0 THEN 60000 ELSE 0 END) AS idle_ms,
       SUM(mouse_move_count + mouse_click_count) AS mouse_events,
       SUM(key_count) AS key_events
     FROM activity_log
     WHERE date BETWEEN ? AND ?
     GROUP BY date
     ORDER BY date`,
    [startDate, endDate]
  )
}

/** 区间内 Top N 应用（周月报用） */
export function getTopAppsRange(
  startDate: string,
  endDate: string,
  limit = 10
): TopApp[] {
  return all<TopApp>(
    `SELECT app_display_name, app_category, SUM(duration_ms) AS total_ms
     FROM window_sessions
     WHERE date BETWEEN ? AND ?
     GROUP BY app_display_name, app_category
     ORDER BY total_ms DESC
     LIMIT ?`,
    [startDate, endDate, limit]
  )
}

// ============================================================
// 设置项读写（AI / 采集 / 黑名单等共用）
// ============================================================

/** 读取单个设置项（不存在返回 def） */
export function getSetting(key: string, def: string): string {
  const row = get<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  )
  return row?.value ?? def
}

/** UPSERT 单个设置项 */
export function setSetting(key: string, value: string): void {
  const stmt = getDb().prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  try {
    stmt.bind([key, value])
    stmt.step()
  } finally {
    stmt.free()
  }
}

/** 读取全部设置项（用于设置页回显） */
export function getAllSettings(): Record<string, string> {
  const rows = all<{ key: string; value: string }>(
    'SELECT key, value FROM settings'
  )
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
