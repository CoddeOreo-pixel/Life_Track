import { getForegroundWindow } from '../native/winForeground'
import { lookupApp } from '../db/appMappings'
import { getDb } from '../db'

// 窗口采集器：定时轮询前台窗口，同进程归一，去重合并写入 window_sessions
// 连续相同进程+标题的采集合并为一条 session，仅更新 end_time/duration

let collecting = true
let timer: NodeJS.Timeout | null = null

// 当前正在记录的段（内存缓存，避免每次都查库 start_time）
let currentSession: { id: number; startTime: number; key: string } | null = null

/** 本地日期字符串 YYYY-MM-DD */
function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function poll(): void {
  if (!collecting) return
  const now = Date.now()
  const win = getForegroundWindow()

  // 无前台窗口（锁屏/登录界面等）→ 结束当前段
  if (!win || !win.processName) {
    currentSession = null
    return
  }

  const mapping = lookupApp(win.processName)
  if (mapping.isBlacklist) {
    currentSession = null
    return
  }

  // key 含日期，跨午夜自动开新段
  const key = `${win.processName}|${win.title}|${todayStr(new Date(now))}`

  if (currentSession && currentSession.key === key) {
    // 同段，更新 end_time + duration
    const duration = now - currentSession.startTime
    const stmt = getDb().prepare(
      'UPDATE window_sessions SET end_time = ?, duration_ms = ? WHERE id = ?'
    )
    try {
      stmt.bind([now, duration, currentSession.id])
      stmt.step()
    } finally {
      stmt.free()
    }
  } else {
    // 新段
    const stmt = getDb().prepare(
      `INSERT INTO window_sessions
       (process_name, process_path, window_title, app_display_name, app_category, start_time, end_time, duration_ms, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    try {
      stmt.bind([
        win.processName,
        win.processPath,
        win.title,
        mapping.displayName,
        mapping.category,
        now,
        now,
        0,
        todayStr(new Date(now))
      ])
      stmt.step()
    } finally {
      stmt.free()
    }
    currentSession = {
      id: getDb().exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number,
      startTime: now,
      key
    }
  }
}

/** 采集间隔（ms），用于 resume 时重建定时器 */
let intervalMsCache = 2000

/** 启动窗口采集 */
export function startWindowCollector(intervalMs = 2000): void {
  intervalMsCache = intervalMs
  if (timer) clearInterval(timer)
  collecting = true
  poll() // 立即采集一次
  timer = setInterval(poll, intervalMs)
  console.log(`[Life_Track] 窗口采集器已启动 (间隔 ${intervalMs}ms)`)
}

/** 停止窗口采集（退出时调用） */
export function stopWindowCollector(): void {
  collecting = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  currentSession = null
}

/** 暂停采集：清除定时器避免空转，恢复时重建 */
export function pauseWindowCollector(): void {
  collecting = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  currentSession = null
}

/** 恢复采集：重建定时器并立即采集一次，避免数据缺口 */
export function resumeWindowCollector(): void {
  if (collecting) return
  collecting = true
  poll() // 立即采集一次，避免最多 intervalMs 的数据缺口
  if (!timer) {
    timer = setInterval(poll, intervalMsCache)
  }
}

/** 获取当前采集状态 */
export function isCollecting(): boolean {
  return collecting
}
