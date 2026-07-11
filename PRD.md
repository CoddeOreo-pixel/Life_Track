# Life_Track 产品需求文档（PRD）

> 版本：v1.0  ·  日期：2026-07-10  ·  状态：待评审
> 项目代号：Life_Track ——「你的一天，数据说了算」

---

## 1. 项目概述

### 1.1 一句话定位
一款本地运行的桌面时间追踪仪表盘，自动采集前台窗口使用记录与鼠标活跃度，按生活场景自动打时段标签，并由 AI 生成每日"灵魂总结"，让用户看清自己每天到底在电脑前干了什么。

### 1.2 解决的问题
- 人对自己"今天干了啥"的认知严重失真（以为在写代码，其实刷了一下午抖音）
- 现有时间追踪软件要手动起停计时器，记不住就漏
- 屏幕使用时间类工具只给冷冰冰的时长数字，不给"人话"反馈

### 1.3 目标用户
- 单用户个人使用（开发者本人），仅本机访问
- 不考虑多用户、不考虑云端、不考虑公网暴露

### 1.4 核心价值
1. **零干预采集**：开机自启、托盘常驻、后台静默记录，用户什么都不用做
2. **场景化标签**：不是冷冰冰的"14:00-16:00"，而是"修仙/早起/干活/干饭/摸鱼"
3. **灵魂总结**：AI 用调侃口吻把数据翻译成人话，每日一针见血

---

## 2. 技术架构总览

### 2.1 整体架构
一体化 Electron 桌面应用，单进程组内既采集又展示：

```
┌─────────────────────────────────────────────────────────┐
│                   Electron App                          │
│                                                         │
│  ┌──────────────────────┐    ┌────────────────────────┐ │
│  │   主进程 (Main)       │    │  渲染进程 (Renderer)    │ │
│  │  ───────────────────  │    │  ──────────────────    │ │
│  │  · 窗口采集器          │    │  · React + Vite 仪表盘  │ │
│  │  · 鼠标/键盘监听       │    │  · ECharts 图表         │ │
│  │  · SQLite 读写层      │◄──►│  · 路由 / 状态管理       │ │
│  │  · AI 总结调度         │ IPC│  · 野兽主义网格 UI       │ │
│  │  · 托盘 / 自启管理     │    │                        │ │
│  └──────────────────────┘    └────────────────────────┘ │
│                  ▲                                      │
│                  │ 仅本机                                │
│                  ▼                                      │
│         localhost HTTP (可选)                           │
└─────────────────────────────────────────────────────────┘
```

### 2.2 技术选型确认

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | Electron | 采集 + 展示一体化 |
| 前端框架 | React 18 + Vite | 主流方案，生态丰富 |
| 图表 | ECharts | 饼图/柱状图/折线/时间线全覆盖 |
| 状态管理 | Zustand | 轻量，避免 Redux 样板 |
| 路由 | React Router v6 | 日/周/月视图切换 |
| 本地数据库 | SQLite (better-sqlite3) | 同步 API，性能好 |
| 窗口采集 | Electron `getFocusedWindow` + Windows API | 主进程原生能力 |
| 鼠标键盘 | Electron `globalShortcut` + `screen` + 原生模块 | 全局监听 |
| AI 接入 | OpenAI 兼容接口 | 用户自填 base_url + key |
| 进程通信 | Electron IPC (contextBridge) | 安全隔离 |

### 2.3 数据流
```
[前台窗口] ─2s轮询─► [采集器] ─去重合并─► [SQLite]
[全局鼠标] ─事件流─► [活跃度计算] ─5s阈值─► [SQLite]
                                              │
                  [渲染进程] ◄──IPC查询── [查询服务]
                                              │
                  [AI 总结调度] ─每晚23:00─► [OpenAI兼容接口]
                                              │
                                              ▼
                                         [SQLite]
```

---

## 3. 功能需求详述

### 3.1 模块一：窗口使用记录采集

#### 3.1.1 采集逻辑
- **轮询间隔**：默认 2 秒（可在设置中调整为 1-10 秒）
- **采集字段**：
  - `timestamp`：采集时间戳（ms）
  - `process_name`：进程名（如 `Code.exe`、`msedge.exe`）
  - `process_path`：进程可执行文件完整路径
  - `window_title`：窗口标题原文（全量记录，不做脱敏）
  - `app_display_name`：展示用名称（如 `Code.exe` → `VS Code`）
- **同进程归一**：同一进程的不同窗口/标签页归到同一进程下
  - 例：Edge 同时开 10 个标签页，标题虽不同，全部计入 `msedge` 进程
  - 例：VS Code 多窗口，全部计入 `Code` 进程
- **去重合并**：连续两次采集若进程名+窗口标题完全相同，合并为一条记录，仅更新 `end_time`

#### 3.1.2 应用识别映射表
内置一份常见应用映射表（可扩展），将进程名转为友好显示名：
```
Code.exe        → VS Code
msedge.exe      → Microsoft Edge
chrome.exe      → Google Chrome
explorer.exe    → 文件资源管理器
WeChat.exe      → 微信
QQ.exe          → QQ
firefox.exe     → Firefox
idea64.exe      → IntelliJ IDEA
pycharm64.exe   → PyCharm
...
```
未命中映射表的，直接展示进程名（去掉 `.exe` 后缀）。

#### 3.1.3 采集黑名单
- 设置页可添加黑名单进程，黑名单内应用**完全不记录**（连进程名都不入库）
- 典型场景：全屏游戏、视频播放器、远程桌面
- 默认黑名单建议：`svchost.exe`、`System`、`Registry` 等系统进程

---

### 3.2 模块二：鼠标活跃度统计

#### 3.2.1 事件采集
- 监听全局事件：
  - 鼠标移动（`mouse-move`）
  - 鼠标点击（左键/右键/中键 `mouse-down`）
  - 键盘按键（`key-down`，仅记事件不记按键内容，保护隐私）
- **不记录坐标**、**不记录按键内容**，仅记录"发生过事件"和时间戳

#### 3.2.2 活跃度计算规则
- **活跃段定义**：5 秒（可配置，范围 1-60 秒）内有任意输入事件 → 该秒为活跃
- **挂机判定**：连续 N 秒（N=挂机阈值）无任何输入事件 → 从最后一次事件后开始记为挂机
- **挂机恢复**：挂机期间一旦有输入事件，立即转回活跃；但挂机 < 30 秒的"短暂挂机"并入前后活跃段（避免去厕所被打断）
- **真正挂机**：挂机 ≥ 30 秒才算"离开座位"，计入挂机时长

#### 3.2.3 状态分类
| 状态 | 判定 | 展示色 |
|---|---|---|
| 活跃干活 | 活跃段 + 当前前台是"生产类"应用（VS Code/IDE/Office） | 绿色 |
| 活跃摸鱼 | 活跃段 + 当前前台是"娱乐类"应用（抖音/B站/游戏） | 橙色 |
| 短暂停顿 | 挂机 < 30 秒 | 灰色（不计入摸鱼） |
| 真挂机 | 挂机 ≥ 30 秒 | 深灰 |

应用分类映射表（可扩展，与 3.1.2 共用）：标记每个应用是 `work` / `entertainment` / `neutral`。

#### 3.2.4 活跃度评分
- 每日活跃度评分 = (活跃时长 / (活跃时长 + 真挂机时长)) × 100，0-100 分
- 仅"活跃摸鱼"占比超 40% 时，评分额外扣 10 分（鼓励别光摸鱼）

---

### 3.3 模块三：时间段标签系统

#### 3.3.1 时段划分（按生活场景）
| 时段 | 时间区间 | 标签名 | 触发条件 |
|---|---|---|---|
| 修仙 | 00:00 - 05:00 | `修仙模式` | 此时仍在使用电脑 |
| 早起 | 05:00 - 08:00 | `早起模式` | 此时使用电脑 |
| 上午 | 08:00 - 12:00 | `上午时段` | — |
| 干饭 | 12:00 - 13:00 | `干饭模式` | 此时**无**电脑使用（连续挂机或关机） |
| 下午 | 13:00 - 18:00 | `下午时段` | — |
| 晚间 | 18:00 - 23:00 | `晚间时段` | — |
| 深夜 | 23:00 - 24:00 | `深夜模式` | 此时仍在使用电脑 |

#### 3.3.2 活跃度叠加标签（与时段标签独立并行）
| 标签 | 判定 |
|---|---|
| `干活模式` | 活跃段 + 前台为生产类应用，持续 ≥ 10 分钟 |
| `摸鱼模式` | 活跃段 + 前台为娱乐类应用，持续 ≥ 5 分钟 |
| `挂机模式` | 真挂机 ≥ 5 分钟 |

#### 3.3.3 标签展示
- 时间线视图：横向时间轴，每个时段用对应颜色块标注
- 时段标签和活跃度标签可叠加显示（如"上午 · 干活模式"）

---

### 3.4 模块四：每日灵魂总结（AI 生成）

#### 3.4.1 触发时机
- **每晚 23:00 自动生成**当日总结
- **手动重生成**：仪表盘首页有"重新生成今日总结"按钮
- 23:00 时若电脑关机，次日开机后补生成

#### 3.4.2 输入数据
向 AI 提供当日结构化数据（不含窗口标题原文，仅统计聚合）：
```json
{
  "date": "2026-07-10",
  "total_active_minutes": 482,
  "total_idle_minutes": 138,
  "top_apps": [
    {"name": "VS Code", "minutes": 186, "category": "work"},
    {"name": "Microsoft Edge", "minutes": 124, "category": "neutral"},
    {"name": "抖音网页版", "minutes": 87, "category": "entertainment"}
  ],
  "time_tags": {
    "修仙模式": 0,
    "早起模式": 35,
    "上午时段": 145,
    "干饭模式": 0,
    "下午时段": 168,
    "晚间时段": 134,
    "深夜模式": 0
  },
  "activity_tags": {
    "干活模式": 220,
    "摸鱼模式": 92,
    "挂机模式": 138
  },
  "mouse_events": 31204,
  "keyboard_events": 8762,
  "window_switches": 87,
  "activity_score": 72
}
```

#### 3.4.3 AI Prompt 模板
```
你是一个毒舌但善意的朋友，根据用户今天的电脑使用数据，写一段 80-150 字的"灵魂总结"。
要求：
1. 用调侃口吻，但不羞辱
2. 抓最有戏剧性的对比（如抖音 vs VS Code 时长）
3. 点出修仙/摸鱼等显著模式
4. 结尾给一句简短鼓励或吐槽
5. 不要罗列数据，要翻译成人话
6. 不要用 emoji

今日数据：{上述JSON}
```

#### 3.4.4 输出展示
- 首页顶部大卡片展示当日总结文字
- 历史总结可在"历史任意日查看"中回看
- 总结存入 SQLite，不重复调用 AI（除非手动重生成）

---

### 3.5 模块五：仪表盘数据展示

#### 3.5.1 页面结构
单页应用，左侧固定侧边栏 + 右侧主内容区，路由切换四个视图：

```
┌──────┬──────────────────────────────────────┐
│ 侧边 │  [今日]  [周报]  [月报]  [时间线]     │
│ 栏   ├──────────────────────────────────────┤
│      │                                      │
│ Logo │           主内容区                    │
│      │                                      │
│ 今日 │                                      │
│ 周报 │                                      │
│ 月报 │                                      │
│ 时间线│                                     │
│ 设置 │                                      │
│      │                                      │
└──────┴──────────────────────────────────────┘
```

#### 3.5.2 今日视图（默认首页）
布局自上而下：

**① 灵魂总结卡片**（顶部大卡）
- 当日 AI 总结文字
- 右下角小字：生成时间 + "重新生成"按钮（橙色）

**② 总览数据卡片行**（4 个等宽卡片）
| 卡片 | 内容 |
|---|---|
| 今日总时长 | HH:MM:SS（活跃+挂机） |
| 最常用应用 | 应用名 + 时长 |
| 活跃度评分 | 0-100 分 + 进度条 |
| 窗口切换次数 | 次数 |

**③ 今日 Top 5 应用排行**（横向卡片列表）
- 排名 + 应用图标 + 名称 + 时长 + 占比进度条
- 第 1 名绿色高亮，其余默认

**④ 饼图：应用时间占比**
- ECharts 饼图，按应用维度
- 鼠标悬浮显示应用名 + 时长 + 百分比
- 旁附图例列表

**⑤ 柱状图：各时段活跃度分布**
- X 轴：24 小时（0-23）
- Y 轴：分钟数
- 堆叠柱：活跃干活（绿）+ 活跃摸鱼（橙）+ 挂机（灰）

**⑥ 时间线：今日窗口切换历史**
- 纵向时间轴，从早到晚
- 每条：时间 + 进程名 + 时长 + 时段标签 + 活跃度标签
- 挂机段单独样式（深灰虚线框）

#### 3.5.3 周报视图
- 顶部日期选择器（默认本周）
- **折线图**：7 天每日活跃时长趋势（绿线）+ 挂机时长（灰线）
- **柱状图**：7 天每日 Top 应用堆叠
- **周对比卡片**：本周总活跃 / 上周总活跃 / 环比百分比（涨绿跌橙）
- **周 Top 5 应用排行**：跨天聚合

#### 3.5.4 月报视图
- 顶部月份选择器
- **热力图**：当月每天活跃度热力（类似 GitHub 贡献图，绿深浅）
- **柱状图**：30 天每日活跃时长
- **月 Top 10 应用排行**
- **月度时段分布**：修仙/早起/...各占多少（堆叠柱）

#### 3.5.5 时间线视图（独立页）
- 日期选择器（默认今日）
- 全屏纵向时间线，颗粒度到分钟
- 支持按应用/标签筛选
- 鼠标滚轮缩放时段

#### 3.5.6 设置页
- 采集设置：轮询间隔、挂机阈值、黑名单管理
- 应用分类管理：手动标记某个进程是 work/entertainment/neutral
- AI 配置：base_url、API Key、模型名、Prompt 自定义
- 总结时间：默认 23:00，可调
- 数据管理：导出 CSV/JSON、清除历史数据、暂停采集
- 开机自启开关
- 关于

---

### 3.6 模块六：数据导出与历史

#### 3.6.1 历史任意日查看
- 所有视图（今日/周报/月报/时间线）都支持日期选择
- 历史日的灵魂总结从 SQLite 读取，不重新调用 AI

#### 3.6.2 数据导出
- 导出范围：可选今日/本周/本月/自定义区间
- 格式：
  - **CSV**：原始窗口记录表（timestamp, process, title, duration）
  - **JSON**：包含窗口记录 + 活跃度 + 总结的完整结构化数据
- 导出按钮在设置页和各视图右上角

#### 3.6.3 周/月同期对比
- 周报视图：本周 vs 上周
- 月报视图：本月 vs 上月
- 对比指标：总活跃时长、活跃度评分、Top 应用变化、摸鱼占比

---

## 4. 数据模型设计（SQLite）

### 4.1 表结构

```sql
-- 窗口使用记录（去重合并后的段）
CREATE TABLE window_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_name TEXT NOT NULL,          -- 进程名 msedge.exe
    process_path TEXT,                   -- 完整路径
    window_title TEXT NOT NULL,          -- 窗口标题原文
    app_display_name TEXT NOT NULL,      -- 展示名 Edge
    app_category TEXT DEFAULT 'neutral', -- work/entertainment/neutral
    start_time INTEGER NOT NULL,         -- 开始时间戳 ms
    end_time INTEGER NOT NULL,           -- 结束时间戳 ms
    duration_ms INTEGER NOT NULL,        -- 时长 ms
    date TEXT NOT NULL                   -- YYYY-MM-DD 便于按日查询
);
CREATE INDEX idx_window_date ON window_sessions(date);
CREATE INDEX idx_window_process ON window_sessions(process_name, date);

-- 活跃度记录（每分钟一条聚合）
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                  -- YYYY-MM-DD
    minute_start INTEGER NOT NULL,       -- 该分钟起始时间戳 ms
    is_active INTEGER NOT NULL,          -- 1=活跃 0=挂机
    mouse_move_count INTEGER DEFAULT 0,
    mouse_click_count INTEGER DEFAULT 0,
    key_count INTEGER DEFAULT 0,
    foreground_process TEXT              -- 该分钟前台进程
);
CREATE INDEX idx_activity_date ON activity_log(date);

-- 时段标签记录（按时段聚合，每日一行）
CREATE TABLE daily_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    tag_xianxian INTEGER DEFAULT 0,      -- 修仙 分钟
    tag_zaoqi INTEGER DEFAULT 0,         -- 早起
    tag_shangwu INTEGER DEFAULT 0,       -- 上午
    tag_ganfan INTEGER DEFAULT 0,        -- 干饭
    tag_xiawu INTEGER DEFAULT 0,         -- 下午
    tag_wanjian INTEGER DEFAULT 0,       -- 晚间
    tag_shenye INTEGER DEFAULT 0,        -- 深夜
    tag_ganhuo INTEGER DEFAULT 0,        -- 干活模式
    tag_moyu INTEGER DEFAULT 0,          -- 摸鱼模式
    tag_guaji INTEGER DEFAULT 0,         -- 挂机模式
    total_active_ms INTEGER DEFAULT 0,
    total_idle_ms INTEGER DEFAULT 0,
    activity_score INTEGER DEFAULT 0,
    window_switches INTEGER DEFAULT 0,
    mouse_events INTEGER DEFAULT 0,
    key_events INTEGER DEFAULT 0
);

-- AI 灵魂总结
CREATE TABLE daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    summary_text TEXT NOT NULL,          -- AI 生成的总结
    input_data TEXT,                     -- 输入 JSON 备份
    model TEXT,                          -- 使用的模型
    generated_at INTEGER NOT NULL,       -- 生成时间戳
    is_manual INTEGER DEFAULT 0          -- 1=手动重生成
);

-- 应用映射配置
CREATE TABLE app_mappings (
    process_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    category TEXT DEFAULT 'neutral',
    is_blacklist INTEGER DEFAULT 0
);

-- 设置项
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### 4.2 关键查询
- **今日 Top 5 应用**：`SELECT app_display_name, SUM(duration_ms) FROM window_sessions WHERE date=? GROUP BY app_display_name ORDER BY 2 DESC LIMIT 5`
- **某日活跃度**：`SELECT minute_start, is_active, foreground_process FROM activity_log WHERE date=?`
- **某日时段标签**：`SELECT * FROM daily_tags WHERE date=?`

---

## 5. 界面设计规范

> 严格遵循项目目录下 `界面风格与视觉主题.txt` 的野兽主义网格规范。以下为关键摘要与本项目专属映射。

### 5.1 色彩角色映射（本项目专属）
| 角色 | 值 | 本项目用途 |
|---|---|---|
| `--surface-0` | #000000 | 仪表盘页面底色 |
| `--surface-1` | #0a0a0a | 侧边栏、设置抽屉 |
| `--surface-2` | #141414 | 数据卡片默认底 |
| `--surface-3` | #1e1e1e | 卡片 hover / 激活态 |
| `--accent` | #22C55E | 干活模式 / Top1 排名 / 活跃干活柱 |
| `--accent-orange` | #FF6B00 | 摸鱼模式 / 重生成按钮 / 活跃摸鱼柱 |
| 灰色 | #555 / #888 | 挂机柱 / 次级文字 |

### 5.2 字体强制
- 所有按钮、导航项、标签、数字、时间戳 → **Fira Code 等宽**
- 大标题/Logo → Lexend Mega
- 正文 → Fira Sans

### 5.3 网格纹理
- 侧边栏：12px 密集网格
- 主内容区：24px 稀疏网格
- 卡片本身无网格，仅页面背景有

### 5.4 图表配色
- 饼图：每个应用分配一个固定色（从绿/橙/灰系衍生，避免彩色）
- 柱状图：干活绿 + 摸鱼橙 + 挂机灰，三色堆叠
- 折线图：活跃绿线 + 挂机灰线
- 热力图：绿色深浅 5 档（从 `rgba(34,197,94,0.1)` 到 `#22C55E`）

### 5.5 交互细节
- 卡片 hover：surface-2 → surface-3 + 绿色 1px 外发光 + 上移 2px
- 按钮 active：scale(0.97)
- 所有过渡 120ms ease-out
- 无渐变、无毛玻璃、无长阴影

---

## 6. 交互与运行时行为

### 6.1 启动与常驻
- **开机自启**：通过 Electron `app.setLoginItemSettings` 注册
- **托盘常驻**：系统托盘图标，右键菜单：
  - 打开仪表盘
  - 暂停/恢复采集
  - 立即生成今日总结
  - 退出
- **静默启动**：开机自启时不弹窗，仅托盘

### 6.2 一键暂停
- 暂停期间不采集任何数据，托盘图标变灰
- 暂停时段在时间线上标注为"手动暂停"（深灰虚线）

### 6.3 仅本机访问
- Electron 渲染窗口仅本机打开
- 不监听任何网络端口对外
- 不发任何遥测

### 6.4 数据写入策略
- 窗口记录：去重合并后批量写入，每 10 秒 flush 一次到 SQLite
- 活跃度：每分钟聚合一条写入
- AI 总结：生成后立即写入

### 6.5 性能要求
- 采集器 CPU 占用 < 1%
- 内存占用 < 150MB
- 仪表盘首屏加载 < 500ms
- 图表渲染 < 200ms

---

## 7. 非功能需求

### 7.1 隐私
- 所有数据仅本地 SQLite，不上传任何服务器
- AI 总结调用时仅发送聚合统计，不发窗口标题原文
- API Key 本地加密存储（Electron `safeStorage`）

### 7.2 可靠性
- 采集器异常崩溃自动重启（监听子进程）
- SQLite 写入失败有重试机制
- AI 调用失败不阻塞其他功能，总结卡片显示"生成失败，点此重试"

### 7.3 可维护性
- 应用映射表、黑名单、分类规则均存 SQLite，可在设置页增删
- Prompt 模板可在设置页自定义
- 时段划分区间可在设置页微调

---

## 8. 项目结构（建议）

```
Life_Track/
├── package.json
├── electron/
│   ├── main/                  # 主进程
│   │   ├── index.ts           # 入口
│   │   ├── collector/
│   │   │   ├── windowCollector.ts   # 窗口采集
│   │   │   ├── activityCollector.ts # 鼠标键盘监听
│   │   │   └── tagEngine.ts         # 时段标签引擎
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── queries.ts
│   │   │   └── index.ts
│   │   ├── ai/
│   │   │   └── summaryGenerator.ts
│   │   ├── tray.ts
│   │   └── ipc.ts             # IPC 处理
│   └── preload/
│       └── index.ts           # contextBridge
├── src/                       # 渲染进程 React
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   │   ├── Today.tsx
│   │   ├── Weekly.tsx
│   │   ├── Monthly.tsx
│   │   ├── Timeline.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   ├── SummaryCard.tsx
│   │   ├── OverviewCards.tsx
│   │   ├── TopAppsChart.tsx
│   │   ├── AppPieChart.tsx
│   │   ├── ActivityBarChart.tsx
│   │   └── WindowTimeline.tsx
│   ├── stores/                # Zustand
│   ├── styles/
│   │   └── brutalism.css      # 野兽主义主题
│   └── types/
├── 界面风格与视觉主题.txt
└── PRD.md
```

---

## 9. 开发里程碑建议

| 阶段 | 内容 | 产出 |
|---|---|---|
| M1 基础架构 | Electron + React + Vite 脚手架，SQLite 接入，野兽主义主题框架 | 可运行的空壳 |
| M2 采集核心 | 窗口采集器 + 鼠标活跃度监听 + 去重合并 + 写库 | 后台静默跑数据 |
| M3 今日视图 | 总览卡片 + Top5 + 饼图 + 柱状图 + 时间线 | 首页可用 |
| M4 时段标签 | 标签引擎 + 标签展示 | 修仙/摸鱼等标签可见 |
| M5 AI 总结 | OpenAI 兼容接入 + Prompt + 调度 + 卡片 | 灵魂总结上线 |
| M6 周报月报 | 折线/柱状/热力图 + 同期对比 | 周月视图可用 |
| M7 设置与导出 | 设置页 + 黑名单 + CSV/JSON 导出 + 暂停 | 完整可用 |
| M8 托盘与自启 | 托盘菜单 + 开机自启 + 崩溃恢复 | 可日常使用 |

---

## 10. 风险与约束

| 风险 | 影响 | 缓解 |
|---|---|---|
| Windows API 取窗口标题偶发失败 | 部分时段数据缺失 | 重试 + 容错，缺失时段标灰 |
| 鼠标全局监听在某些权限下被拦 | 活跃度不准 | 启动时检测并提示用户 |
| AI 接口网络不稳 | 总结生成失败 | 重试 3 次，失败显示占位文案 |
| SQLite 长期积累数据量大 | 查询变慢 | 按月分区表 + 索引，半年以上数据可归档 |
| 全屏游戏/视频时窗口标题不更新 | 时长统计偏差 | 用户可加黑名单或手动暂停 |

---

## 11. 待确认事项（评审时讨论）

1. **应用分类初始表**：work/entertainment/neutral 的初始映射清单需要你和开发一起补全（哪些算摸鱼哪些算干活）
2. **AI 总结字数**：默认 80-150 字，是否需要"短/中/长"三档可选
3. **热力图色阶**：月报热力图是用绿色单色深浅，还是绿+橙双色（干活绿/摸鱼橙）
4. **多显示器**：当前只取主屏前台窗口，多屏场景是否需要支持
5. **锁屏 vs 关机**：锁屏期间算挂机还是不算（当前方案算挂机）

---

## 12. 附录：用户原始需求对照

| 原始需求 | 对应模块 | 状态 |
|---|---|---|
| 每隔几秒查前台窗口，记进程/标题/时间戳，同进程归一 | 3.1 | ✓ |
| 应用时长日/周/月视图 + 今日 Top5 | 3.5.3 / 3.5.4 / 3.5.2③ | ✓ |
| 鼠标活跃度，活跃/挂机，干活/摸鱼判定 | 3.2 | ✓ |
| 时间段标签：修仙/早起/干活/干饭/摸鱼 | 3.3 | ✓ |
| 每日灵魂总结（接入 AI） | 3.4 | ✓ |
| 仪表盘卡片 + 饼图 + 柱状图 + 时间线 | 3.5.2 | ✓ |
| 数据导出 + 历史查看 + 黑名单 + 同期对比 | 3.6 | ✓ |
| 野兽主义网格视觉风格 | 5 | ✓ |

---

**文档结束。请评审后告知是否需要调整，确认后进入开发阶段。**
