import { uIOhook } from 'uiohook-napi'
import { powerMonitor } from 'electron'
import { getForegroundWindow } from '../native/winForeground'
import { getDb } from '../db'

// 活跃度采集器：监听全局鼠标/键盘事件，按挂机阈值判定活跃/挂机，每分钟聚合写库
// 锁屏期间一律计为挂机（powerMonitor lock-screen 事件）

let started = false
let collecting = true
let locked = false

let idleThresholdMs = 5000 // 挂机阈值，默认 5 秒

// 最后一次输入事件时间戳
let lastEventTs = Date.now()

// 当前分钟的累计数据
interface MinuteBucket {
  start: number // 该分钟起始时间戳
  mouseMove: number
  mouseClick: number
  key: number
  activeSeconds: number // 该分钟内活跃秒数
}
let bucket: MinuteBucket = freshBucket()

let secondTimer: NodeJS.Timeout | null = null

function freshBucket(): MinuteBucket {
  const now = Date.now()
  return {
    start: now - (now % 60000), // 对齐到分钟起始
    mouseMove: 0,
    mouseClick: 0,
    key: 0,
    activeSeconds: 0
  }
}

function todayStr(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 判定当前是否活跃（5 秒内有事件且未锁屏） */
export function isCurrentlyActive(): boolean {
  if (locked || !collecting) return false
  return Date.now() - lastEventTs <= idleThresholdMs
}

function onInputEvent(move: boolean, click: boolean, key: boolean): void {
  if (!collecting || locked) return
  lastEventTs = Date.now()
  if (move) bucket.mouseMove++
  if (click) bucket.mouseClick++
  if (key) bucket.key++
}

/** 每秒 tick：累计活跃秒数，并在跨分钟时 flush */
function tickSecond(): void {
  if (!collecting) return // 暂停时不 tick，避免写入全零脏数据
  const now = Date.now()
  // 跨分钟 → flush 上一分钟
  if (now - bucket.start >= 60000) {
    flushBucket()
  }
  if (isCurrentlyActive()) {
    bucket.activeSeconds++
  }
}

/** 将当前分钟 bucket 写入 activity_log，并开启新 bucket */
function flushBucket(): void {
  // 该分钟活跃秒数 >= 30 视为活跃分钟（超过半分钟）
  const isActive = bucket.activeSeconds >= 30 ? 1 : 0
  const foreground = getForegroundWindow()?.processName || ''

  const stmt = getDb().prepare(
    `INSERT INTO activity_log
     (date, minute_start, is_active, mouse_move_count, mouse_click_count, key_count, foreground_process)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  try {
    stmt.bind([
      todayStr(new Date(bucket.start)),
      bucket.start,
      isActive,
      bucket.mouseMove,
      bucket.mouseClick,
      bucket.key,
      foreground
    ])
    stmt.step()
  } catch (err) {
    console.error('[Life_Track] 写入活跃度失败:', err)
  } finally {
    stmt.free()
  }

  bucket = freshBucket()
}

/** 启动活跃度采集 */
export function startActivityCollector(idleSeconds = 5): void {
  if (started) return
  started = true
  collecting = true
  idleThresholdMs = idleSeconds * 1000
  lastEventTs = Date.now()
  bucket = freshBucket()

  // 注册全局事件监听
  uIOhook.on('mousemove', () => onInputEvent(true, false, false))
  uIOhook.on('mousedown', () => onInputEvent(false, true, false))
  uIOhook.on('keydown', () => onInputEvent(false, false, true))
  uIOhook.start()

  // 锁屏 = 挂机
  powerMonitor.on('lock-screen', () => {
    locked = true
    console.log('[Life_Track] 检测到锁屏，计为挂机')
  })
  powerMonitor.on('unlock-screen', () => {
    locked = false
    lastEventTs = Date.now() // 解锁时刻重置，避免立即判定挂机
    console.log('[Life_Track] 解锁，恢复活跃度判定')
  })

  // 每秒 tick
  secondTimer = setInterval(tickSecond, 1000)
  console.log(`[Life_Track] 活跃度采集器已启动 (挂机阈值 ${idleSeconds}s)`)
}

/** 停止活跃度采集 */
export function stopActivityCollector(): void {
  if (secondTimer) {
    clearInterval(secondTimer)
    secondTimer = null
  }
  // 退出前 flush 最后一分钟数据，避免丢失（无论是否暂停，bucket 里可能有未写入的数据）
  if (started) {
    try {
      flushBucket()
    } catch {
      /* ignore */
    }
  }
  if (started) {
    try {
      uIOhook.stop()
      uIOhook.removeAllListeners()
    } catch {
      /* ignore */
    }
  }
  started = false
  collecting = false
}

export function pauseActivityCollector(): void {
  collecting = false
  // 清除定时器避免空转
  if (secondTimer) {
    clearInterval(secondTimer)
    secondTimer = null
  }
  // flush 当前 bucket，避免恢复后新旧数据混合在同一分钟
  if (started && bucket.activeSeconds > 0) {
    try {
      flushBucket()
    } catch {
      /* ignore */
    }
  }
}

export function resumeActivityCollector(): void {
  if (started && !collecting) {
    collecting = true
    lastEventTs = Date.now()
    // 重建定时器
    if (!secondTimer) {
      secondTimer = setInterval(tickSecond, 1000)
    }
  }
}
