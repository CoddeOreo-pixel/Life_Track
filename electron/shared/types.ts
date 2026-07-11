// ============================================================
// 主进程 / 渲染进程共享的数据类型
// preload 和 queries 都从这里导入，避免重复定义
// ============================================================

export interface TopApp {
  app_display_name: string
  app_category: string
  total_ms: number
}

export interface OverviewStats {
  total_foreground_ms: number // 前台应用总时长（含挂机）
  total_active_ms: number // 真正活跃时长（鼠标键盘有动作）
  total_idle_ms: number // 挂机时长
  window_switches: number // 窗口切换次数
  top_app_name: string
  top_app_ms: number
  mouse_move_count: number // 鼠标移动事件次数（量级大，每秒数十次）
  mouse_click_count: number // 鼠标点击次数
  key_events: number // 键盘按键次数
  activity_score: number // 活跃度评分 0-100
}

export interface HourlyActivity {
  hour: number // 0-23（本地时区）
  active_ms: number
  idle_ms: number
}

export interface WindowSessionRow {
  id: number
  app_display_name: string
  app_category: string
  process_name: string
  window_title: string
  start_time: number
  end_time: number
  duration_ms: number
}

export interface MinuteActivity {
  minute_start: number
  is_active: number
  mouse_move_count: number
  mouse_click_count: number
  key_count: number
  foreground_process: string
}

export interface DailyActivity {
  date: string
  active_ms: number
  idle_ms: number
  mouse_events: number
  key_events: number
}

export interface DailyTags {
  date: string
  tag_shenye: number
  tag_zaoqi: number
  tag_shangwu: number
  tag_ganfan: number
  tag_xiawu: number
  tag_wanjian: number
  tag_ganhuo: number
  tag_moyu: number
  tag_guaji: number
  tag_xianxian: number
  total_active_ms: number
  total_idle_ms: number
  activity_score: number
  window_switches: number
  mouse_events: number
  key_events: number
}

/** 时段标签的合法字段名 */
export type TagKey =
  | 'tag_shenye'
  | 'tag_zaoqi'
  | 'tag_shangwu'
  | 'tag_ganfan'
  | 'tag_xiawu'
  | 'tag_wanjian'
  | 'tag_ganhuo'
  | 'tag_moyu'
  | 'tag_guaji'
  | 'tag_xianxian'

/** AI 灵魂总结记录 */
export interface DailySummary {
  date: string
  summary_text: string
  model: string | null
  generated_at: number
  is_manual: number
}

/** 应用映射记录（设置页黑名单管理用） */
export interface AppMappingRow {
  process_name: string
  display_name: string
  category: string
  is_blacklist: number
}

/** 标签定义：key、显示名、描述、颜色（主进程和渲染进程共享） */
export const TAG_DEFS: Array<{
  key: TagKey
  label: string
  desc: string
  color: string
}> = [
  { key: 'tag_xianxian', label: '修仙模式', desc: '凌晨 1-4 点还在用电脑', color: '#9b59b6' },
  { key: 'tag_shenye', label: '深夜模式', desc: '0-5 点有使用记录', color: '#8e44ad' },
  { key: 'tag_zaoqi', label: '早起模式', desc: '5-8 点就开始用电脑', color: '#f1c40f' },
  { key: 'tag_shangwu', label: '上午模式', desc: '8-12 点', color: '#27ae60' },
  { key: 'tag_ganfan', label: '干饭模式', desc: '中午没在用电脑', color: '#e67e22' },
  { key: 'tag_xiawu', label: '下午模式', desc: '12-18 点', color: '#16a085' },
  { key: 'tag_wanjian', label: '晚间模式', desc: '18-24 点', color: '#2c3e50' },
  { key: 'tag_ganhuo', label: '干活模式', desc: '活跃度较高', color: '#00ff88' },
  { key: 'tag_moyu', label: '摸鱼模式', desc: '活跃度较低', color: '#ff8800' },
  { key: 'tag_guaji', label: '挂机模式', desc: '完全无操作', color: '#888' }
]
