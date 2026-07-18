import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { initDatabase, closeDatabase, getDb } from './db'
import { seedAppMappings, repairEmptyDisplayNames } from './db/appMappings'
import {
  getAllAppMappings,
  setAppBlacklist,
  upsertAppMapping,
  clearMappingCache,
  syncMappingsToHistory
} from './db/appMappings'
import {
  startWindowCollector,
  stopWindowCollector,
  pauseWindowCollector,
  resumeWindowCollector,
  isCollecting
} from './collector/windowCollector'
import {
  startActivityCollector,
  stopActivityCollector,
  pauseActivityCollector,
  resumeActivityCollector
} from './collector/activityCollector'
import {
  getTopApps,
  getOverview,
  getHourlyActivity,
  getWindowSessions,
  getMinuteActivity,
  getDailyActivityRange,
  getTopAppsRange,
  getSetting,
  setSetting,
  getAllSettings
} from './db/queries'
import { saveDailyTags, getDailyTags } from './db/tagEngine'
import {
  getSummary,
  generateSummary,
  startAutoSummaryScheduler,
  stopAutoSummaryScheduler
} from './ai/summaryEngine'
import {
  createTray,
  refreshTray,
  destroyTray,
  getIsQuitting,
  markQuitting
} from './tray'

let mainWindow: BrowserWindow | null = null
let initialized = false
let crashCount = 0

/** 向所有渲染进程广播采集状态变更（IPC 切换时调用，托盘切换由 tray.ts 内部广播） */
function broadcastCollectingState(collecting: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('collecting:changed', collecting)
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Life_Track',
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    crashCount = 0 // 渲染进程成功加载，重置崩溃计数
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 关闭窗口时最小化到托盘，而非退出（仅托盘"退出"才真正退出）
  mainWindow.on('close', (e) => {
    if (!getIsQuitting()) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

/** 启动数据采集（尊重已保存的 collecting 设置） */
function startCollecting(): void {
  const pollInterval = (parseInt(getSetting('poll_interval_seconds', '2')) || 2) * 1000
  const idleThreshold = parseInt(getSetting('idle_threshold_seconds', '5')) || 5
  // 若上次退出时处于暂停状态，启动时跳过首次 poll 避免写入 0 时长脏 session
  const shouldCollect = getSetting('collecting', 'true') !== 'false'
  startWindowCollector(pollInterval, !shouldCollect)
  startActivityCollector(idleThreshold)
  if (!shouldCollect) {
    pauseWindowCollector()
    pauseActivityCollector()
    console.log('[Life_Track] 已恢复为暂停采集状态')
  }
}

/** 注册采集控制 IPC */
function registerIpc(): void {
  // 采集控制
  ipcMain.handle('collecting:status', () => isCollecting())
  ipcMain.handle('collecting:pause', () => {
    pauseWindowCollector()
    pauseActivityCollector()
    setSetting('collecting', 'false')
    refreshTray(() => mainWindow)
    // 通知所有渲染进程同步采集状态（避免托盘切换后设置页 UI 错乱）
    broadcastCollectingState(false)
    console.log('[Life_Track] 采集已暂停')
  })
  ipcMain.handle('collecting:resume', () => {
    resumeWindowCollector()
    resumeActivityCollector()
    setSetting('collecting', 'true')
    refreshTray(() => mainWindow)
    broadcastCollectingState(true)
    console.log('[Life_Track] 采集已恢复')
  })

  // 数据查询 —— 今日视图
  ipcMain.handle('query:topApps', (_e, date: string, limit?: number) =>
    getTopApps(date, limit)
  )
  ipcMain.handle('query:overview', (_e, date: string) => getOverview(date))
  ipcMain.handle('query:hourlyActivity', (_e, date: string) =>
    getHourlyActivity(date)
  )
  ipcMain.handle('query:windowSessions', (_e, date: string) =>
    getWindowSessions(date)
  )
  ipcMain.handle('query:minuteActivity', (_e, date: string) =>
    getMinuteActivity(date)
  )

  // 数据查询 —— 周月报
  ipcMain.handle(
    'query:dailyRange',
    (_e, start: string, end: string) => getDailyActivityRange(start, end)
  )
  ipcMain.handle(
    'query:topAppsRange',
    (_e, start: string, end: string, limit?: number) =>
      getTopAppsRange(start, end, limit)
  )

  // 时段标签
  ipcMain.handle('tags:get', (_e, date: string) => getDailyTags(date))
  ipcMain.handle('tags:recompute', (_e, date: string) => saveDailyTags(date))

  // AI 灵魂总结
  ipcMain.handle('summary:get', (_e, date: string) => getSummary(date))
  ipcMain.handle('summary:regenerate', async (_e, date: string) => {
    // force=true 强制重新生成（手动触发）
    return generateSummary(date, true)
  })

  // 设置项
  ipcMain.handle('settings:get', (_e, key: string, def: string) =>
    getSetting(key, def)
  )
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    setSetting(key, value)
    // 采集参数变更后自动重启采集器，使新设置立即生效
    if (key === 'poll_interval_seconds' || key === 'idle_threshold_seconds') {
      const pollInterval = (parseInt(getSetting('poll_interval_seconds', '2')) || 2) * 1000
      const idleThreshold = parseInt(getSetting('idle_threshold_seconds', '5')) || 5
      const wasCollecting = isCollecting()
      stopWindowCollector()
      stopActivityCollector()
      // 若暂停态重启，跳过首次 poll，避免写入 0 时长脏 session
      startWindowCollector(pollInterval, !wasCollecting)
      startActivityCollector(idleThreshold)
      if (!wasCollecting) {
        pauseWindowCollector()
        pauseActivityCollector()
      }
      console.log(`[Life_Track] 采集参数已变更并重启采集器 (间隔 ${pollInterval}ms, 挂机阈值 ${idleThreshold}s)`)
    }
  })
  ipcMain.handle('settings:getAll', () => getAllSettings())

  // 开机自启
  ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('autostart:set', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    setSetting('auto_start', enabled ? 'true' : 'false')
  })

  // 应用映射 / 黑名单
  ipcMain.handle('mappings:list', () => getAllAppMappings())
  ipcMain.handle(
    'mappings:setBlacklist',
    (_e, processName: string, isBlacklist: boolean) => {
      setAppBlacklist(processName, isBlacklist)
      clearMappingCache()
    }
  )
  ipcMain.handle(
    'mappings:add',
    (_e, processName: string, displayName: string, category: string) => {
      const valid = ['work', 'entertainment', 'neutral']
      if (!valid.includes(category)) {
        throw new Error(`无效的分类: ${category}`)
      }
      upsertAppMapping(
        processName,
        displayName,
        category as 'work' | 'entertainment' | 'neutral'
      )
      clearMappingCache()
      syncMappingsToHistory(processName)
    }
  )
  ipcMain.handle(
    'mappings:updateCategory',
    (_e, processName: string, category: string) => {
      const valid = ['work', 'entertainment', 'neutral']
      if (!valid.includes(category)) {
        throw new Error(`无效的分类: ${category}`)
      }
      upsertAppMapping(
        processName,
        '',
        category as 'work' | 'entertainment' | 'neutral'
      )
      clearMappingCache()
      syncMappingsToHistory(processName)
    }
  )

  // 数据导出（CSV / JSON）
  ipcMain.handle(
    'export:data',
    async (_e, table: string, format: string) => {
      // 白名单校验，防止 SQL 注入
      const allowed = ['window_sessions', 'activity_log', 'daily_tags', 'daily_summaries']
      if (!allowed.includes(table)) {
        throw new Error(`不支持导出表: ${table}`)
      }
      const fmt = format === 'json' ? 'json' : 'csv'

      // 查询全表数据
      const stmt = getDb().prepare(`SELECT * FROM ${table}`)
      let cols: string[]
      const rows: Record<string, unknown>[] = []
      try {
        cols = stmt.getColumnNames()
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as Record<string, unknown>)
        }
      } finally {
        stmt.free()
      }

      // 生成文件内容
      let content: string
      let ext: string
      if (fmt === 'json') {
        content = JSON.stringify(rows, null, 2)
        ext = 'json'
      } else {
        const header = cols.map(csvCell).join(',')
        const lines = rows.map((r) =>
          cols.map((c) => csvCell(r[c])).join(',')
        )
        content = [header, ...lines].join('\n')
        ext = 'csv'
      }

      // 生成默认文件名 life_track_<table>_<YYYY-MM-DD>.<ext>
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const defaultName = `life_track_${table}_${dateStr}.${ext}`

      const result = await dialog.showSaveDialog(
        mainWindow ?? undefined,
        {
        defaultPath: defaultName,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })
      if (result.canceled || !result.filePath) return null
      await fs.writeFile(result.filePath, content, 'utf-8')
      return result.filePath
    }
  )
}

/** CSV 单元格转义：含逗号/引号/换行时用双引号包裹，内部引号双写 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ===== 单例锁：防止多开 =====
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 已有实例运行时，显示主窗口
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    await initDatabase()
    seedAppMappings()
    // 修复历史脏数据：把 app_mappings 和 window_sessions 里空的 display_name 补上
    repairEmptyDisplayNames()
    registerIpc()

    createWindow()
    createTray(() => mainWindow)
    startCollecting()
    startAutoSummaryScheduler()
    initialized = true

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  }).catch((err: unknown) => {
    console.error('[Life_Track] 启动失败:', err)
    dialog.showErrorBox(
      'Life_Track 启动失败',
      err instanceof Error ? err.message : String(err)
    )
    app.quit()
  })
}

// ===== 退出清理 =====
app.on('before-quit', () => {
  markQuitting()
  destroyTray()
  if (!initialized) return // 第二实例未初始化，跳过资源清理
  stopWindowCollector()
  stopActivityCollector()
  stopAutoSummaryScheduler()
  closeDatabase()
})

// 托盘模式下，窗口全部关闭不退出应用（保持后台采集）
app.on('window-all-closed', () => {
  // 不执行 app.quit()，仅由托盘"退出"或 before-quit 触发退出
})

// ===== 崩溃恢复 =====
app.on('render-process-gone', (_e, _wc, details) => {
  console.error('[Life_Track] 渲染进程崩溃:', details.reason)
  if (getIsQuitting()) return // 退出中不重启
  if (crashCount >= 5) {
    console.error('[Life_Track] 崩溃次数过多，停止自动重启')
    return
  }
  crashCount++
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload()
  }
})

app.on('gpu-process-crashed', () => {
  console.error('[Life_Track] GPU 进程崩溃')
})

app.on('child-process-gone', (_e, details) => {
  console.error('[Life_Track] 子进程退出:', details.type, details.reason)
})

process.on('uncaughtException', (err) => {
  console.error('[Life_Track] 未捕获异常:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Life_Track] 未处理的 Promise Rejection:', reason)
})
