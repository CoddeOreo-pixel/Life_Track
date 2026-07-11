import { getDb } from './index'
import { getMinuteActivity, getOverview } from './queries'
import type { MinuteActivity, DailyTags } from '../../shared/types'

// TAG_DEFS / TagKey 已移至 shared/types 共享，避免渲染进程导入主进程模块

/**
 * 根据分钟活跃度数据计算当天标签（纯函数，无 DB 查询）
 * @param date 日期字符串
 * @param minutes 按分钟的活跃度数据
 * @param windowSwitches 当天窗口切换次数（由调用方传入）
 */
export function computeTags(
  date: string,
  minutes: MinuteActivity[],
  windowSwitches: number
): DailyTags {
  let shenye = 0 // 0-5
  let zaoqi = 0 // 5-8
  let shangwu = 0 // 8-12
  let ganfan = 0 // 11-13（非活跃时间）
  let xiawu = 0 // 12-18
  let wanjian = 0 // 18-24
  let xianxian = 0 // 1-4
  let ganhuo = 0 // 活跃分钟数
  let moyu = 0 // 非活跃但有少量输入
  let guaji = 0 // 完全无输入

  let activeMs = 0
  let idleMs = 0
  let mouseEvents = 0
  let keyEvents = 0

  for (const m of minutes) {
    const hour = new Date(m.minute_start).getHours()
    const active = m.is_active === 1
    const hasInput = m.mouse_move_count + m.mouse_click_count + m.key_count > 0

    if (active) {
      activeMs += 60000
      ganhuo++
    } else {
      idleMs += 60000
      if (hasInput) moyu++
      else guaji++
    }
    mouseEvents += m.mouse_move_count + m.mouse_click_count
    keyEvents += m.key_count

    // 时段统计（按本地小时）
    // 修仙 1-4点 | 深夜 0-4点 | 早起 5-7点 | 上午 8-11点 | 干饭 11-12点(非活跃) | 下午 12-17点 | 晚间 18-23点
    if (hour >= 1 && hour < 5) xianxian++
    if (hour < 5) shenye++
    else if (hour < 8) zaoqi++
    if (hour >= 8 && hour < 12) shangwu++
    if (hour >= 11 && hour < 13) {
      if (!active) ganfan++
    }
    if (hour >= 12 && hour < 18) xiawu++
    if (hour >= 18) wanjian++
  }

  const totalMs = activeMs + idleMs
  const score = totalMs > 0 ? Math.round((activeMs / totalMs) * 100) : 0

  return {
    date,
    tag_shenye: shenye,
    tag_zaoqi: zaoqi,
    tag_shangwu: shangwu,
    tag_ganfan: ganfan,
    tag_xiawu: xiawu,
    tag_wanjian: wanjian,
    tag_ganhuo: ganhuo,
    tag_moyu: moyu,
    tag_guaji: guaji,
    tag_xianxian: xianxian,
    total_active_ms: activeMs,
    total_idle_ms: idleMs,
    activity_score: score,
    window_switches: windowSwitches,
    mouse_events: mouseEvents,
    key_events: keyEvents
  }
}

/** 计算并持久化当天标签（UPSERT） */
export function saveDailyTags(date: string): DailyTags {
  const minutes = getMinuteActivity(date)
  const overview = getOverview(date)
  const tags = computeTags(date, minutes, overview.window_switches)

  const stmt = getDb().prepare(
    `INSERT INTO daily_tags
     (date, tag_xianxian, tag_zaoqi, tag_shangwu, tag_ganfan, tag_xiawu,
      tag_wanjian, tag_shenye, tag_ganhuo, tag_moyu, tag_guaji,
      total_active_ms, total_idle_ms, activity_score, window_switches,
      mouse_events, key_events)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET
       tag_xianxian=excluded.tag_xianxian, tag_zaoqi=excluded.tag_zaoqi,
       tag_shangwu=excluded.tag_shangwu, tag_ganfan=excluded.tag_ganfan,
       tag_xiawu=excluded.tag_xiawu, tag_wanjian=excluded.tag_wanjian,
       tag_shenye=excluded.tag_shenye, tag_ganhuo=excluded.tag_ganhuo,
       tag_moyu=excluded.tag_moyu, tag_guaji=excluded.tag_guaji,
       total_active_ms=excluded.total_active_ms, total_idle_ms=excluded.total_idle_ms,
       activity_score=excluded.activity_score, window_switches=excluded.window_switches,
       mouse_events=excluded.mouse_events, key_events=excluded.key_events`
  )
  try {
    stmt.bind([
      tags.date,
      tags.tag_xianxian,
      tags.tag_zaoqi,
      tags.tag_shangwu,
      tags.tag_ganfan,
      tags.tag_xiawu,
      tags.tag_wanjian,
      tags.tag_shenye,
      tags.tag_ganhuo,
      tags.tag_moyu,
      tags.tag_guaji,
      tags.total_active_ms,
      tags.total_idle_ms,
      tags.activity_score,
      tags.window_switches,
      tags.mouse_events,
      tags.key_events
    ])
    stmt.step()
  } finally {
    stmt.free()
  }
  return tags
}

/** 读取当天标签（无则返回 null） */
export function getDailyTags(date: string): DailyTags | null {
  const stmt = getDb().prepare(
    `SELECT date, tag_xianxian, tag_zaoqi, tag_shangwu, tag_ganfan,
            tag_xiawu, tag_wanjian, tag_shenye, tag_ganhuo, tag_moyu,
            tag_guaji, total_active_ms, total_idle_ms, activity_score,
            window_switches, mouse_events, key_events
     FROM daily_tags WHERE date = ?`
  )
  try {
    stmt.bind([date])
    if (stmt.step()) {
      return stmt.getAsObject() as DailyTags
    }
    return null
  } finally {
    stmt.free()
  }
}
