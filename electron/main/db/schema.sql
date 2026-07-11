-- Life_Track 数据库 Schema
-- 窗口使用记录（去重合并后的段）
CREATE TABLE IF NOT EXISTS window_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_name TEXT NOT NULL,
    process_path TEXT,
    window_title TEXT NOT NULL,
    app_display_name TEXT NOT NULL,
    app_category TEXT DEFAULT 'neutral',
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_window_date ON window_sessions(date);
CREATE INDEX IF NOT EXISTS idx_window_process ON window_sessions(process_name, date);

-- 活跃度记录（每分钟一条聚合）
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    minute_start INTEGER NOT NULL,
    is_active INTEGER NOT NULL,
    mouse_move_count INTEGER DEFAULT 0,
    mouse_click_count INTEGER DEFAULT 0,
    key_count INTEGER DEFAULT 0,
    foreground_process TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(date);
CREATE INDEX IF NOT EXISTS idx_activity_date_minute ON activity_log(date, minute_start);

-- 时段标签记录（每日一行）
CREATE TABLE IF NOT EXISTS daily_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    tag_xianxian INTEGER DEFAULT 0,
    tag_zaoqi INTEGER DEFAULT 0,
    tag_shangwu INTEGER DEFAULT 0,
    tag_ganfan INTEGER DEFAULT 0,
    tag_xiawu INTEGER DEFAULT 0,
    tag_wanjian INTEGER DEFAULT 0,
    tag_shenye INTEGER DEFAULT 0,
    tag_ganhuo INTEGER DEFAULT 0,
    tag_moyu INTEGER DEFAULT 0,
    tag_guaji INTEGER DEFAULT 0,
    total_active_ms INTEGER DEFAULT 0,
    total_idle_ms INTEGER DEFAULT 0,
    activity_score INTEGER DEFAULT 0,
    window_switches INTEGER DEFAULT 0,
    mouse_events INTEGER DEFAULT 0,
    key_events INTEGER DEFAULT 0
);

-- AI 灵魂总结
CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    summary_text TEXT NOT NULL,
    input_data TEXT,
    model TEXT,
    generated_at INTEGER NOT NULL,
    is_manual INTEGER DEFAULT 0
);

-- 应用映射配置
CREATE TABLE IF NOT EXISTS app_mappings (
    process_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    category TEXT DEFAULT 'neutral',
    is_blacklist INTEGER DEFAULT 0
);

-- 设置项
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
