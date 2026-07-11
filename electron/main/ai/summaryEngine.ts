import { getDb } from '../db'
import { getSetting, getOverview, getTopApps } from '../db/queries'
import { getDailyTags } from '../db/tagEngine'
import { TAG_DEFS } from '../../shared/types'
import type { DailySummary } from '../../shared/types'

// ============================================================
// AI 灵魂总结引擎
// - 构造 Prompt（基于 overview + topApps + tags）
// - 调用 OpenAI 兼容 /chat/completions 接口
// - 写入 daily_summaries（UPSERT）
// - 每晚定时自动生成
// ============================================================

/** 毫秒转人类可读时长（如 "1小时23分"） */
function humanMs(ms: number): string {
  if (ms <= 0) return '0分'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0 && m > 0) return `${h}小时${m}分`
  if (h > 0) return `${h}小时`
  return `${m}分`
}

/** 本地日期字符串 YYYY-MM-DD */
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 查询某日总结 */
export function getSummary(date: string): DailySummary | null {
  const stmt = getDb().prepare(
    `SELECT date, summary_text, model, generated_at, is_manual
     FROM daily_summaries WHERE date = ?`
  )
  try {
    stmt.bind([date])
    if (stmt.step()) {
      return stmt.getAsObject() as unknown as DailySummary
    }
    return null
  } finally {
    stmt.free()
  }
}

/** UPSERT 总结 */
function saveSummary(
  date: string,
  text: string,
  model: string,
  isManual: boolean,
  inputData: string
): void {
  const stmt = getDb().prepare(
    `INSERT INTO daily_summaries (date, summary_text, input_data, model, generated_at, is_manual)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       summary_text = excluded.summary_text,
       input_data = excluded.input_data,
       model = excluded.model,
       generated_at = excluded.generated_at,
       is_manual = excluded.is_manual`
  )
  try {
    stmt.bind([date, text, inputData, model, Date.now(), isManual ? 1 : 0])
    stmt.step()
  } finally {
    stmt.free()
  }
}

/** 构造发送给 LLM 的输入数据快照 */
function buildInputData(date: string) {
  const overview = getOverview(date)
  const topApps = getTopApps(date, 5)
  const tags = getDailyTags(date)
  return { overview, topApps, tags }
}

/** 根据数据构造中文 Prompt */
function buildPrompt(
  date: string,
  data: ReturnType<typeof buildInputData>
): string {
  const { overview, topApps, tags } = data
  const lines: string[] = []

  // 当前时间（生成总结的时刻），让 AI 能感知是深夜、清晨还是工作时段
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const curTime = `${hh}:${mm}`

  // 用户身份（由用户在设置页自定义，如"大学生"/"前端程序员"/"产品经理"）
  const identity = (getSetting('user_identity', '') || '').trim()

  lines.push(`你是 Life_Track 的灵魂总结官，请根据用户 ${date} 的电脑使用数据，写一段幽默风趣、毒舌但不恶意的中文灵魂总结。`)
  lines.push('要求：120-200字，可以用修仙/摸鱼/卷王等梗，结尾给一句简短点评或明日建议，不要用 markdown 语法。')
  lines.push('')
  lines.push('【重要：写作时必须结合以下上下文】')
  lines.push(`- 当前时间: ${curTime}（请根据时间点选择语气，如深夜可以催促睡觉，清晨可以鼓励早起，午后可以吐槽犯困）`)
  if (identity) {
    lines.push(`- 用户身份: ${identity}（请针对该身份使用相关梗和吐槽点，如程序员谈 bug/代码，大学生谈论文/逃课，产品经理谈需求/PRD）`)
  }
  lines.push('')
  lines.push('【今日数据】')
  lines.push(`- 前台总时长: ${humanMs(overview.total_foreground_ms)}`)
  lines.push(`- 真正活跃: ${humanMs(overview.total_active_ms)}，挂机: ${humanMs(overview.total_idle_ms)}`)
  lines.push(`- 活跃度评分: ${overview.activity_score}/100`)
  lines.push(`- 窗口切换: ${overview.window_switches} 次`)
  lines.push(`- 鼠标点击: ${overview.mouse_click_count} 次，鼠标移动: ${overview.mouse_move_count} 次，键盘: ${overview.key_events} 次`)
  if (topApps.length > 0) {
    const appList = topApps
      .map((a, i) => `  ${i + 1}. ${a.app_display_name} (${a.app_category}) - ${humanMs(a.total_ms)}`)
      .join('\n')
    lines.push(`- Top 应用:\n${appList}`)
  }
  if (tags) {
    const activeLabels: string[] = []
    for (const def of TAG_DEFS) {
      if ((tags[def.key] as number) > 0) {
        activeLabels.push(def.label)
      }
    }
    if (activeLabels.length > 0) {
      lines.push(`- 命中模式: ${activeLabels.join(' / ')}`)
    }
  }
  return lines.join('\n')
}

/** 调用 OpenAI 兼容 /chat/completions 接口 */
async function callLLM(prompt: string): Promise<{ text: string; model: string }> {
  // 用 || 兜底：兼容旧库中 ai_base_url='' 的空串种子（INSERT OR IGNORE 不会覆盖已存在行）
  const baseUrl = (getSetting('ai_base_url', 'https://api.openai.com/v1') || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const apiKey = getSetting('ai_api_key', '')
  const model = getSetting('ai_model', 'gpt-4o-mini') || 'gpt-4o-mini'

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请在设置页填写')
  }

  const url = `${baseUrl}/chat/completions`
  // 30 秒超时，避免 API 响应缓慢或网络故障时无限期挂起
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)
  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是 Life_Track 的灵魂总结官，擅长用幽默毒舌的中文总结用户一天的电脑使用情况。' +
              '你会收到【上下文】（当前时间、用户身份）和【今日数据】两部分信息。' +
              '写作时必须体现你对当前时间和用户身份的感知：' +
              '根据时间点调整语气（深夜催睡、清晨鼓励、午后吐槽犯困），' +
              '针对用户身份使用贴切的梗（程序员/大学生/产品经理等）。' +
              '不要直接复述"当前时间是XX"或"你是XX"，而是自然地融入总结中。'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 400
      }),
      signal: controller.signal
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('AI 接口请求超时（30 秒），请检查网络或 API 服务状态')
    }
    throw e
  }
  clearTimeout(timeoutId)

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    throw new Error(`AI 接口返回 ${resp.status}: ${errText.slice(0, 200)}`)
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    model?: string
  }
  const text = json.choices?.[0]?.message?.content?.trim()
  if (!text) {
    throw new Error('AI 返回内容为空')
  }
  return { text, model: json.model ?? model }
}

/**
 * 生成某日灵魂总结
 * @param date 日期 YYYY-MM-DD
 * @param force true=强制重新生成（手动）；false=若已存在且非空则跳过
 */
export async function generateSummary(
  date: string,
  force: boolean
): Promise<DailySummary> {
  // 非强制模式：已有总结则直接返回
  if (!force) {
    const exist = getSummary(date)
    if (exist && exist.summary_text) return exist
  }

  const enabled = getSetting('ai_enabled', 'true')
  if (enabled !== 'true') {
    throw new Error('AI 总结已关闭，请在设置页开启')
  }

  const data = buildInputData(date)
  const prompt = buildPrompt(date, data)
  const { text, model } = await callLLM(prompt)
  saveSummary(date, text, model, force, JSON.stringify(data))
  const saved = getSummary(date)
  if (!saved) {
    throw new Error('总结保存后查询失败')
  }
  return saved
}

// ============================================================
// 定时自动生成调度
// ============================================================

let autoTimer: NodeJS.Timeout | null = null
let lastAutoDate = ''

/** 检查并触发自动生成（每分钟由 timer 调用） */
async function checkAutoGenerate(): Promise<void> {
  const enabled = getSetting('ai_enabled', 'true')
  if (enabled !== 'true') return

  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const curTime = `${hh}:${mm}`
  // 规范化目标时间：把 "9:0" / "23:0" 等补成 "09:00" / "23:00"，避免字符串比较失配
  const rawTarget = getSetting('ai_auto_time', '23:00') || '23:00'
  const [th, tm] = rawTarget.split(':')
  const targetTime = `${String(th || '23').padStart(2, '0')}:${String(tm || '00').padStart(2, '0')}`
  const today = localDateStr(now)

  // 到达或超过目标时间且今天还没自动生成过（用 >= 避免定时器漂移错过整分钟）
  if (curTime >= targetTime && lastAutoDate !== today) {
    try {
      await generateSummary(today, false)
      // 仅成功后才标记，失败时下一分钟可重试
      lastAutoDate = today
      console.log(`[Life_Track] 已自动生成 ${today} 的灵魂总结`)
    } catch (e) {
      console.error(`[Life_Track] 自动生成总结失败:`, e instanceof Error ? e.message : e)
    }
  }
}

/** 启动自动总结调度（每晚检查一次是否到目标时间） */
export function startAutoSummaryScheduler(): void {
  if (autoTimer) return
  // 每 60 秒检查一次，足够精确且开销极低
  autoTimer = setInterval(() => {
    checkAutoGenerate().catch(() => null)
  }, 60_000)
}

/** 停止自动总结调度 */
export function stopAutoSummaryScheduler(): void {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
}
