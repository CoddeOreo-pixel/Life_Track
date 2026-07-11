import { create } from 'zustand'
import type { DailyActivity, TopApp } from '../../electron/preload'

// ============================================================
// 周报 / 月报通用 store
// 支持任意区间 + 同期对比（上一周 / 上月）
// ============================================================

interface RangeState {
  start: string
  end: string
  daily: DailyActivity[]
  topApps: TopApp[]
  // 同期对比数据
  prevDaily: DailyActivity[]
  prevTopApps: TopApp[]
  prevStart: string
  prevEnd: string
  loading: boolean
  error: string | null

  loadRange: (
    start: string,
    end: string,
    prevStart: string,
    prevEnd: string
  ) => Promise<void>
}

let reqId = 0

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const useRangeStore = create<RangeState>((set) => ({
  start: '',
  end: '',
  daily: [],
  topApps: [],
  prevDaily: [],
  prevTopApps: [],
  prevStart: '',
  prevEnd: '',
  loading: false,
  error: null,

  loadRange: async (start, end, prevStart, prevEnd) => {
    const myId = ++reqId
    // 立即清空旧数据，避免周报/月报切换时数据串台（旧区间数据 + 新区间元数据混显示）
    set({
      loading: true,
      error: null,
      start,
      end,
      prevStart,
      prevEnd,
      daily: [],
      topApps: [],
      prevDaily: [],
      prevTopApps: []
    })
    try {
      const [daily, topApps, prevDaily, prevTopApps] = await Promise.all([
        window.lifeTrack.query.dailyRange(start, end),
        window.lifeTrack.query.topAppsRange(start, end, 10),
        window.lifeTrack.query.dailyRange(prevStart, prevEnd),
        window.lifeTrack.query.topAppsRange(prevStart, prevEnd, 10)
      ])
      if (myId !== reqId) return
      set({ daily, topApps, prevDaily, prevTopApps, loading: false })
    } catch (e) {
      if (myId !== reqId) return
      set({ loading: false, error: errMsg(e) })
    }
  }
}))
