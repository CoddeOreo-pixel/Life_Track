import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import {
  isCollecting,
  pauseWindowCollector,
  resumeWindowCollector
} from './collector/windowCollector'
import {
  pauseActivityCollector,
  resumeActivityCollector
} from './collector/activityCollector'
import { setSetting } from './db/queries'

let tray: Tray | null = null
let isQuitting = false

/** 用户是否真正要退出（而非最小化到托盘） */
export function getIsQuitting(): boolean {
  return isQuitting
}

/** 标记正在退出（before-quit 时调用，处理 OS 关机等外部退出场景） */
export function markQuitting(): void {
  isQuitting = true
}

/** 标记退出并退出应用 */
export function quitApp(): void {
  isQuitting = true
  tray?.destroy()
  tray = null
  app.quit()
}

/**
 * 创建 16x16 托盘图标：从 build/icon.png 加载并缩放。
 * 回退：若文件不存在则用程序化绿色方块。
 */
function createTrayIcon(): nativeImage {
  try {
    const iconPath = join(app.getAppPath(), 'build', 'icon.png')
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) {
      return img.resize({ width: 16, height: 16 })
    }
  } catch { /* 回退到程序化图标 */ }
  // 程序化回退：绿色方块
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1
      if (border) {
        buf[i] = 0x14; buf[i + 1] = 0x14; buf[i + 2] = 0x14; buf[i + 3] = 255
      } else {
        buf[i] = 0x5e; buf[i + 1] = 0xc5; buf[i + 2] = 0x22; buf[i + 3] = 255
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

/** 显示并聚焦窗口 */
function showWindow(win: BrowserWindow | null): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

/** 切换采集状态（托盘菜单用） */
function toggleCollecting(): void {
  if (isCollecting()) {
    pauseWindowCollector()
    pauseActivityCollector()
    setSetting('collecting', 'false')
    broadcastCollecting(false)
  } else {
    resumeWindowCollector()
    resumeActivityCollector()
    setSetting('collecting', 'true')
    broadcastCollecting(true)
  }
}

/** 向所有渲染进程广播采集状态变更 */
function broadcastCollecting(collecting: boolean): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('collecting:changed', collecting)
  }
}

/** 构建托盘右键菜单 */
function buildMenu(getWindow: () => BrowserWindow | null): Menu {
  const collecting = isCollecting()
  return Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => showWindow(getWindow())
    },
    {
      label: collecting ? '暂停采集' : '恢复采集',
      click: () => {
        toggleCollecting()
        refreshTray(getWindow)
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => quitApp()
    }
  ])
}

/** 刷新托盘提示文字与菜单（采集状态变化后调用） */
export function refreshTray(getWindow: () => BrowserWindow | null): void {
  if (!tray) return
  const collecting = isCollecting()
  tray.setToolTip(`Life_Track — ${collecting ? '采集中' : '已暂停'}`)
  tray.setContextMenu(buildMenu(getWindow))
}

/** 销毁托盘（退出时调用，避免 OS 关机路径下托盘图标残留） */
export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** 创建系统托盘 */
export function createTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return // 已存在则不重复创建，防止托盘图标泄漏
  const icon = createTrayIcon()
  tray = new Tray(icon)
  refreshTray(getWindow)

  // 单击托盘图标：显示/聚焦窗口
  tray.on('click', () => {
    const win = getWindow()
    if (win && win.isVisible() && !win.isMinimized()) {
      win.focus()
    } else {
      showWindow(win)
    }
  })
}
