import { create } from 'zustand'
import type {
  TopApp,
  OverviewStats,
  HourlyActivity,
  WindowSessionRow,
  MinuteActivity,
  DailyTags,
  DailySummary
} from '../../electron/preload'

// ============================================================
// 今日视图数据 store
// ============================================================

interface TodayState {
  date: string
  overview: OverviewStats | null
  topApps: TopApp[]
  hourly: HourlyActivity[]
  sessions: WindowSessionRow[]
  minutes: MinuteActivity[]
  tags: DailyTags | null
  summary: DailySummary | null
  generating: boolean
  summaryError: string | null
  loading: boolean
  error: string | null

  loadAll: (date: string) => Promise<void>
  loadMinutes: (date: string) => Promise<void>
  regenerateSummary: (date: string) => Promise<void>
}

// 竞态保护：记录最新一次请求的 ID，过时响应被丢弃
let reqId = 0

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useTodayStore = create<TodayState>((set) => ({
  date: '',
  overview: null,
  topApps: [],
  hourly: [],
  sessions: [],
  minutes: [],
  tags: null,
  summary: null,
  generating: false,
  summaryError: null,
  loading: false,
  error: null,

  loadAll: async (date: string) => {
    const myId = ++reqId
    set({ loading: true, error: null, date })
    try {
      // 先重算标签（写入 daily_tags），再并行查询所有数据
      // recompute / tags.get / summary.get 失败不阻断主流程（各自返回 null）
      await window.lifeTrack.tags.recompute(date).catch(() => null)
      const [overview, topApps, hourly, sessions, tags, summary] = await Promise.all([
        window.lifeTrack.query.overview(date),
        window.lifeTrack.query.topApps(date, 5),
        window.lifeTrack.query.hourlyActivity(date),
        window.lifeTrack.query.windowSessions(date),
        window.lifeTrack.tags.get(date).catch(() => null),
        window.lifeTrack.summary.get(date).catch(() => null)
      ])
      // 过时响应丢弃
      if (myId !== reqId) return
      set({ overview, topApps, hourly, sessions, tags, summary, loading: false })
    } catch (e) {
      if (myId !== reqId) return
      set({ loading: false, error: errMsg(e) })
    }
  },

  loadMinutes: async (date: string) => {
    try {
      const minutes = await window.lifeTrack.query.minuteActivity(date)
      set({ minutes })
    } catch (e) {
      console.error('加载分钟数据失败:', errMsg(e))
    }
  },

  regenerateSummary: async (date: string) => {
    // 竞态保护：已在生成中则忽略后续请求
    if (useTodayStore.getState().generating) return
    set({ generating: true, summaryError: null })
    try {
      const summary = await window.lifeTrack.summary.regenerate(date)
      set({ summary, generating: false })
    } catch (e) {
      set({ generating: false, summaryError: errMsg(e) })
    }
  }
}))
