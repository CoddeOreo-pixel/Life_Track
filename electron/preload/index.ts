import { contextBridge, ipcRenderer } from 'electron'
import type {
  TopApp,
  OverviewStats,
  HourlyActivity,
  WindowSessionRow,
  MinuteActivity,
  DailyActivity,
  DailyTags,
  TagKey,
  DailySummary,
  AppMappingRow
} from '../shared/types'

// re-export 共享类型，供渲染进程 import type 使用
export type {
  TopApp,
  OverviewStats,
  HourlyActivity,
  WindowSessionRow,
  MinuteActivity,
  DailyActivity,
  DailyTags,
  TagKey,
  DailySummary,
  AppMappingRow
} from '../shared/types'
export { TAG_DEFS } from '../shared/types'

// 通过 contextBridge 暴露安全的 API 给渲染进程
// 采集控制 + 数据查询 + 后续 AI/设置等

const api = {
  // ===== 采集控制 =====
  collecting: {
    status: () => ipcRenderer.invoke('collecting:status') as Promise<boolean>,
    pause: () => ipcRenderer.invoke('collecting:pause'),
    resume: () => ipcRenderer.invoke('collecting:resume')
  },

  // ===== 数据查询 =====
  query: {
    topApps: (date: string, limit?: number) =>
      ipcRenderer.invoke('query:topApps', date, limit) as Promise<TopApp[]>,
    overview: (date: string) =>
      ipcRenderer.invoke('query:overview', date) as Promise<OverviewStats>,
    hourlyActivity: (date: string) =>
      ipcRenderer.invoke('query:hourlyActivity', date) as Promise<HourlyActivity[]>,
    windowSessions: (date: string) =>
      ipcRenderer.invoke('query:windowSessions', date) as Promise<WindowSessionRow[]>,
    minuteActivity: (date: string) =>
      ipcRenderer.invoke('query:minuteActivity', date) as Promise<MinuteActivity[]>,
    dailyRange: (start: string, end: string) =>
      ipcRenderer.invoke('query:dailyRange', start, end) as Promise<DailyActivity[]>,
    topAppsRange: (start: string, end: string, limit?: number) =>
      ipcRenderer.invoke('query:topAppsRange', start, end, limit) as Promise<TopApp[]>
  },

  // ===== 时段标签 =====
  tags: {
    get: (date: string) =>
      ipcRenderer.invoke('tags:get', date) as Promise<DailyTags | null>,
    recompute: (date: string) =>
      ipcRenderer.invoke('tags:recompute', date) as Promise<DailyTags>
  },

  // ===== AI 灵魂总结 =====
  summary: {
    get: (date: string) =>
      ipcRenderer.invoke('summary:get', date) as Promise<DailySummary | null>,
    regenerate: (date: string) =>
      ipcRenderer.invoke('summary:regenerate', date) as Promise<DailySummary>
  },

  // ===== 设置项 =====
  settings: {
    get: (key: string, def: string) =>
      ipcRenderer.invoke('settings:get', key, def) as Promise<string>,
    set: (key: string, value: string) =>
      ipcRenderer.invoke('settings:set', key, value) as Promise<void>,
    getAll: () =>
      ipcRenderer.invoke('settings:getAll') as Promise<Record<string, string>>
  },

  // ===== 应用映射 / 黑名单 =====
  mappings: {
    list: () =>
      ipcRenderer.invoke('mappings:list') as Promise<AppMappingRow[]>,
    setBlacklist: (processName: string, isBlacklist: boolean) =>
      ipcRenderer.invoke(
        'mappings:setBlacklist',
        processName,
        isBlacklist
      ) as Promise<void>,
    add: (processName: string, displayName: string, category: string) =>
      ipcRenderer.invoke(
        'mappings:add',
        processName,
        displayName,
        category
      ) as Promise<void>
  },

  // ===== 数据导出 =====
  export: {
    data: (table: string, format: 'csv' | 'json') =>
      ipcRenderer.invoke('export:data', table, format) as Promise<string | null>
  },

  // ===== 开机自启 =====
  autostart: {
    get: () => ipcRenderer.invoke('autostart:get') as Promise<boolean>,
    set: (enabled: boolean) =>
      ipcRenderer.invoke('autostart:set', enabled) as Promise<void>
  },

  // ===== 通用订阅 =====
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: unknown, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },

  /** 平台信息 */
  platform: process.platform
}

export type LifeTrackApi = typeof api

contextBridge.exposeInMainWorld('lifeTrack', api)
