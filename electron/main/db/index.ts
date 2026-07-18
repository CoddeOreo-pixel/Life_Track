import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { app, BrowserWindow } from 'electron'
// schema 内联
import schema from './schema.sql?raw'

let SQL: SqlJsStatic | null = null
let db: Database | null = null
let dbPath = ''
let tmpPath = ''
let flushTimer: NodeJS.Timeout | null = null
let lastFlushError = '' // 最近一次持久化错误，空表示正常

/**
 * sql.js 版数据库：纯 WASM，数据在内存操作，定期 export() 持久化
 * 持久化策略：写 .tmp 新文件 → rename 原子替换
 *   绕开安全软件"允许创建新文件、拦截覆盖已有文件"的保护规则
 */

/** 初始化数据库连接并建表 */
export async function initDatabase(): Promise<void> {
  if (db) return

  // 加载 WASM（locateFile 指向 dist 目录的 wasm 文件）
  const wasmPath = join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')
  SQL = await initSqlJs({
    locateFile: (file: string) => (existsSync(wasmPath) ? wasmPath : file)
  })

  // 数据库存放在项目根目录下的 data 文件夹（火绒白名单覆盖项目目录，可写）
  // dev: out/main/ → ../../data = 项目根/data
  // prod: 打包后 app.getAppPath() 不同，此时回退到 userData
  let dataDir: string
  try {
    const projectDataDir = join(__dirname, '..', '..', 'data')
    // 测试是否可写（创建一个探针文件）
    const probe = join(projectDataDir, '.probe')
    mkdirSync(projectDataDir, { recursive: true })
    writeFileSync(probe, '1')
    unlinkSync(probe)
    dataDir = projectDataDir
  } catch {
    // 项目目录不可写（打包后等情况），回退到 userData
    dataDir = app.getPath('userData')
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }
  }
  dbPath = join(dataDir, 'life_track_data.bin')
  tmpPath = dbPath + '.tmp'
  console.log('[Life_Track] 数据目录:', dataDir)

  // 已有文件则加载，否则新建空库
  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath)
    db = new SQL.Database(new Uint8Array(buf))
  } else {
    db = new SQL.Database()
  }

  // 建表（IF NOT EXISTS，安全重复执行）
  db.run(schema)

  // 迁移：为旧版数据库补齐后续新增的列（CREATE TABLE IF NOT EXISTS 不会改已存在表结构）
  runMigrations()

  // 写入默认设置（仅首次）
  seedDefaultSettings()

  // 启动定期持久化（每 10 秒把内存库写回文件）
  startAutoFlush()

  console.log('[Life_Track] 数据库初始化完成 (sql.js):', dbPath)
}

/** 获取数据库实例 */
export function getDb(): Database {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()')
  }
  return db
}

/** 把内存库立即写回文件（写 .tmp → rename 旧为 .bak → rename .tmp 为主 → 删 .bak） */
export function flushDatabase(): void {
  if (!db) return
  try {
    const data = db.export()
    const bakPath = dbPath + '.bak'
    // 1. 先写到临时文件（每次都是新文件，安全软件通常允许创建）
    writeFileSync(tmpPath, Buffer.from(data))
    // 2. 将旧主文件重命名为 .bak（保留备份，避免 rename .tmp 失败时数据丢失）
    let hadOld = false
    try { renameSync(dbPath, bakPath); hadOld = true } catch { /* 不存在忽略 */ }
    // 3. 原子重命名临时文件为主文件
    try {
      renameSync(tmpPath, dbPath)
    } catch (e) {
      // rename .tmp 失败：回滚，把 .bak 恢复为主文件
      if (hadOld) {
        try { renameSync(bakPath, dbPath) } catch { /* ignore */ }
      }
      throw e
    }
    // 4. 成功后删除 .bak
    if (hadOld) {
      try { unlinkSync(bakPath) } catch { /* ignore */ }
    }
    // 持久化成功，清除错误状态
    if (lastFlushError) {
      lastFlushError = ''
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('db:flush-error', '')
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    lastFlushError = msg
    console.error('[Life_Track] 持久化失败:', msg)
    // 通知所有渲染进程显示持久化失败提示
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('db:flush-error', msg)
    }
  }
}

/** 查询最近一次持久化错误（空表示正常） */
export function getFlushError(): string {
  return lastFlushError
}

/** 清除持久化错误状态（下次 flush 成功后自动清除） */
export function clearFlushError(): void {
  lastFlushError = ''
}

/** 启动自动持久化定时器 */
function startAutoFlush(): void {
  if (flushTimer) return
  flushTimer = setInterval(flushDatabase, 10000)
}

/** 关闭数据库连接（退出前必须 flush） */
export function closeDatabase(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  if (db) {
    flushDatabase()
    db.close()
    db = null
  }
}

/**
 * 迁移：为旧版数据库补齐后续新增的列。
 * CREATE TABLE IF NOT EXISTS 不会修改已存在表的结构，需要用 ALTER TABLE 补列。
 * 用 PRAGMA table_info 检查列是否已存在，避免重复添加报错。
 */
function runMigrations(): void {
  if (!db) return

  // 检查某表是否有某列
  function hasColumn(table: string, column: string): boolean {
    const rows = db!.exec(`PRAGMA table_info(${table})`)
    if (!rows.length) return false
    return rows[0].values.some((r) => r[1] === column)
  }

  // 安全添加列（已存在则跳过）
  function addColumn(table: string, column: string, def: string): void {
    if (!hasColumn(table, column)) {
      db!.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`)
      console.log(`[Life_Track] 迁移: ${table}.${column} 已添加`)
    }
  }

  // window_sessions.duration_ms（旧版可能缺失）
  addColumn('window_sessions', 'duration_ms', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('window_sessions', 'app_category', "TEXT DEFAULT 'neutral'")
  // activity_log.foreground_process（旧版可能缺失）
  addColumn('activity_log', 'foreground_process', 'TEXT')
}

/** 写入默认设置项 */
function seedDefaultSettings(): void {
  const defaults: Record<string, string> = {
    poll_interval_seconds: '2',
    idle_threshold_seconds: '5',
    ai_auto_time: '23:00',
    ai_base_url: 'https://api.openai.com/v1',
    ai_api_key: '',
    ai_model: 'gpt-4o-mini',
    ai_enabled: 'true',
    ai_style: 'balanced',
    user_identity: '',
    auto_start: 'false',
    collecting: 'true'
  }
  for (const [key, value] of Object.entries(defaults)) {
    // INSERT OR IGNORE —— 已存在的不覆盖
    db!.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [
      key,
      value
    ])
  }
}
