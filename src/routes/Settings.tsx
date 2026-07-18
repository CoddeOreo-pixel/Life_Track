import { useEffect, useState, useCallback, useRef } from 'react'
import type { AppMappingRow } from '../../electron/preload'

// ============================================================
// 设置视图：采集 / AI / 黑名单 / 导出
// ============================================================

const EXPORT_TABLES = [
  { key: 'window_sessions', label: '窗口记录' },
  { key: 'activity_log', label: '活跃度日志' },
  { key: 'daily_tags', label: '时段标签' },
  { key: 'daily_summaries', label: '灵魂总结' }
]

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [collecting, setCollecting] = useState(true)
  const [autoStart, setAutoStart] = useState(false)
  const [mappings, setMappings] = useState<AppMappingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const msgTimer = useRef<number | null>(null)

  const notify = useCallback((m: string) => {
    setMsg(m)
    if (msgTimer.current !== null) window.clearTimeout(msgTimer.current)
    msgTimer.current = window.setTimeout(() => setMsg(null), 2500)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [all, list, status, auto] = await Promise.all([
        window.lifeTrack.settings.getAll(),
        window.lifeTrack.mappings.list(),
        window.lifeTrack.collecting.status(),
        window.lifeTrack.autostart.get()
      ])
      setSettings(all)
      setMappings(list)
      setCollecting(status)
      setAutoStart(auto)
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
    // 订阅采集状态变更（托盘切换 / 其他窗口切换时同步本页 UI）
    const off = window.lifeTrack.on('collecting:changed', (...args: unknown[]) => {
      const next = args[0] as boolean
      setCollecting(next)
    })
    return () => {
      off()
      if (msgTimer.current !== null) window.clearTimeout(msgTimer.current)
    }
  }, [load])

  /** 保存单个设置项 */
  const saveSetting = async (key: string, value: string) => {
    try {
      await window.lifeTrack.settings.set(key, value)
      setSettings((s) => ({ ...s, [key]: value }))
    } catch (e) {
      notify(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 切换采集暂停/恢复 */
  const toggleCollecting = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (collecting) {
        await window.lifeTrack.collecting.pause()
        setCollecting(false)
        notify('采集已暂停')
      } else {
        await window.lifeTrack.collecting.resume()
        setCollecting(true)
        notify('采集已恢复')
      }
    } catch (e) {
      notify(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 切换开机自启 */
  const toggleAutoStart = async () => {
    if (busy) return
    setBusy(true)
    try {
      const next = !autoStart
      await window.lifeTrack.autostart.set(next)
      setAutoStart(next)
      notify(next ? '已开启开机自启' : '已关闭开机自启')
    } catch (e) {
      notify(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 切换黑名单 */
  const toggleBlacklist = async (row: AppMappingRow) => {
    if (busy) return
    setBusy(true)
    try {
      const next = row.is_blacklist !== 1
      await window.lifeTrack.mappings.setBlacklist(row.process_name, next)
      await load()
      notify(next ? '已加入黑名单' : '已取消黑名单')
    } catch (e) {
      notify(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 修改应用分类 */
  const handleCategoryChange = async (processName: string, category: string) => {
    if (busy) return
    setBusy(true)
    try {
      await window.lifeTrack.mappings.updateCategory(processName, category)
      await load()
      notify('分类已更新')
    } catch (e) {
      notify(`操作失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 导出数据 */
  const doExport = async (table: string, format: 'csv' | 'json') => {
    if (busy) return
    setBusy(true)
    try {
      const path = await window.lifeTrack.export.data(table, format)
      if (path) notify(`已导出到：${path}`)
      else notify('已取消导出')
    } catch (e) {
      notify(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page">加载中...</div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">设置</h1>
        {msg && <span className="page-loading">{msg}</span>}
      </div>

      {/* 采集控制 */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">采集控制</h2>
          <button className="btn-terminal" disabled={busy} onClick={toggleCollecting}>
            {collecting ? '$ pause' : '$ resume'}
          </button>
        </div>
        <div className="setting-row">
          <span className="setting-label">当前状态</span>
          <span className={collecting ? 'status-on' : 'status-off'}>
            {collecting ? '采集中' : '已暂停'}
          </span>
        </div>
        <div className="setting-row">
          <span className="setting-label">开机自启</span>
          <button
            className="btn-terminal"
            disabled={busy}
            onClick={toggleAutoStart}
          >
            {autoStart ? '$ on ✓' : '$ off'}
          </button>
        </div>
      </div>

      {/* 采集参数 */}
      <div className="panel">
        <h2 className="panel-title">采集参数</h2>
        <div className="setting-row">
          <span className="setting-label">轮询间隔（秒）</span>
          <input
            className="setting-input"
            type="number"
            min={1}
            max={60}
            defaultValue={settings.poll_interval_seconds ?? '2'}
            onBlur={(e) => {
              const v = String(Math.max(1, Math.min(60, parseInt(e.target.value) || 2)))
              e.target.value = v
              saveSetting('poll_interval_seconds', v)
            }}
          />
        </div>
        <div className="setting-row">
          <span className="setting-label">挂机阈值（秒）</span>
          <input
            className="setting-input"
            type="number"
            min={1}
            max={300}
            defaultValue={settings.idle_threshold_seconds ?? '5'}
            onBlur={(e) => {
              const v = String(Math.max(1, Math.min(300, parseInt(e.target.value) || 5)))
              e.target.value = v
              saveSetting('idle_threshold_seconds', v)
            }}
          />
        </div>
        <div className="setting-hint">改后下次采集周期生效</div>
      </div>

      {/* AI 配置 */}
      <div className="panel">
        <h2 className="panel-title">AI 灵魂总结</h2>
        <div className="setting-row">
          <span className="setting-label">启用 AI 总结</span>
          <select
            className="setting-input"
            defaultValue={settings.ai_enabled ?? 'true'}
            onChange={(e) => saveSetting('ai_enabled', e.target.value)}
          >
            <option value="true">开启</option>
            <option value="false">关闭</option>
          </select>
        </div>
        <div className="setting-row">
          <span className="setting-label">总结风格</span>
          <select
            className="setting-input"
            defaultValue={settings.ai_style ?? 'balanced'}
            onChange={(e) => saveSetting('ai_style', e.target.value)}
          >
            <option value="gentle">温柔</option>
            <option value="balanced">适中</option>
            <option value="toxic">毒蛇</option>
          </select>
        </div>
        <div className="setting-hint">温柔=治愈鼓励 / 适中=幽默毒舌但不恶意 / 毒蛇=犀利嘲讽不留情面</div>
        <div className="setting-row">
          <span className="setting-label">你的身份</span>
          <input
            className="setting-input"
            type="text"
            placeholder="如：大学生 / 前端程序员 / 产品经理"
            defaultValue={settings.user_identity ?? ''}
            onBlur={(e) => saveSetting('user_identity', e.target.value.trim())}
          />
        </div>
        <div className="setting-hint">AI 生成灵魂总结时会参考你的身份，让吐槽更贴脸</div>
        <div className="setting-row">
          <span className="setting-label">接口地址</span>
          <input
            className="setting-input"
            type="text"
            placeholder="https://api.openai.com/v1"
            defaultValue={settings.ai_base_url ?? ''}
            onBlur={(e) => saveSetting('ai_base_url', e.target.value)}
          />
        </div>
        <div className="setting-row">
          <span className="setting-label">API Key</span>
          <input
            className="setting-input"
            type="password"
            placeholder="sk-..."
            defaultValue={settings.ai_api_key ?? ''}
            onBlur={(e) => saveSetting('ai_api_key', e.target.value)}
          />
        </div>
        <div className="setting-row">
          <span className="setting-label">模型</span>
          <input
            className="setting-input"
            type="text"
            placeholder="gpt-4o-mini"
            defaultValue={settings.ai_model ?? ''}
            onBlur={(e) => saveSetting('ai_model', e.target.value)}
          />
        </div>
        <div className="setting-row">
          <span className="setting-label">自动生成时间</span>
          <input
            className="setting-input"
            type="text"
            placeholder="23:00"
            defaultValue={settings.ai_auto_time ?? '23:00'}
            onBlur={(e) => saveSetting('ai_auto_time', e.target.value)}
          />
        </div>
      </div>

      {/* 黑名单管理 */}
      <BlacklistPanel
        mappings={mappings}
        onToggle={toggleBlacklist}
        onAdded={load}
        onCategoryChange={handleCategoryChange}
        notify={notify}
        busy={busy}
      />

      {/* 数据导出 */}
      <div className="panel">
        <h2 className="panel-title">数据导出</h2>
        <div className="export-grid">
          {EXPORT_TABLES.map((t) => (
            <div key={t.key} className="export-row">
              <span className="export-label">{t.label}</span>
              <button
                className="btn-terminal"
                disabled={busy}
                onClick={() => doExport(t.key, 'csv')}
              >
                $ csv
              </button>
              <button
                className="btn-terminal"
                disabled={busy}
                onClick={() => doExport(t.key, 'json')}
              >
                $ json
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 黑名单管理面板 */
function BlacklistPanel({
  mappings,
  onToggle,
  onAdded,
  onCategoryChange,
  notify,
  busy
}: {
  mappings: AppMappingRow[]
  onToggle: (row: AppMappingRow) => void
  onAdded: () => void
  onCategoryChange: (processName: string, category: string) => void
  notify: (m: string) => void
  busy: boolean
}) {
  const [processName, setProcessName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [category, setCategory] = useState('neutral')
  const [adding, setAdding] = useState(false)

  const add = async () => {
    if (!processName.trim()) return
    setAdding(true)
    try {
      await window.lifeTrack.mappings.add(
        processName.trim(),
        displayName.trim() || processName.trim(),
        category
      )
      setProcessName('')
      setDisplayName('')
      setCategory('neutral')
      onAdded()
      notify('已添加映射')
    } catch (e) {
      notify(`添加失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="panel">
      <h2 className="panel-title">应用映射 / 黑名单</h2>

      {/* 新增映射 */}
      <div className="blacklist-add">
        <input
          className="setting-input"
          type="text"
          placeholder="进程名（如 chrome.exe）"
          value={processName}
          onChange={(e) => setProcessName(e.target.value)}
        />
        <input
          className="setting-input"
          type="text"
          placeholder="显示名（可选）"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <select
          className="setting-input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="work">干活</option>
          <option value="entertainment">摸鱼</option>
          <option value="neutral">中性</option>
        </select>
        <button className="btn-terminal" disabled={adding || busy} onClick={add}>
          $ add
        </button>
      </div>

      {/* 映射列表 */}
      <div className="blacklist-list">
        {mappings.length === 0 ? (
          <div className="empty">暂无映射数据</div>
        ) : (
          mappings.map((m) => (
            <div key={m.process_name} className="blacklist-row">
              <span
                className="top-dot"
                style={{
                  backgroundColor:
                    m.category === 'work'
                      ? '#22c55e'
                      : m.category === 'entertainment'
                        ? '#ff6b00'
                        : '#888'
                }}
              />
              <span className="blacklist-process">{m.process_name}</span>
              <span className="blacklist-display">{m.display_name}</span>
              <select
                className="setting-input cat-select"
                value={m.category}
                onChange={(e) => onCategoryChange(m.process_name, e.target.value)}
                disabled={busy}
              >
                <option value="work">干活</option>
                <option value="entertainment">摸鱼</option>
                <option value="neutral">中性</option>
              </select>
              <button
                className={m.is_blacklist === 1 ? 'btn-terminal active' : 'btn-terminal'}
                disabled={busy}
                onClick={() => onToggle(m)}
              >
                {m.is_blacklist === 1 ? '$ 黑名单 ✓' : '$ 加入黑名单'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
