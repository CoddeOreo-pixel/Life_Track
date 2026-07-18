import { getDb } from './index'
import type { AppMappingRow } from '../../shared/types'

export interface AppMapping {
  displayName: string
  category: 'work' | 'entertainment' | 'neutral'
  isBlacklist: boolean
}

// 默认应用映射表 —— 干活(work) / 摸鱼(entertainment) / 中性(neutral) / 黑名单
const DEFAULT_MAPPINGS: Array<{
  process: string
  display: string
  category: AppMapping['category']
  blacklist?: boolean
}> = [
  // ===== 干活 work =====
  { process: 'Code.exe', display: 'VS Code', category: 'work' },
  { process: 'idea64.exe', display: 'IntelliJ IDEA', category: 'work' },
  { process: 'idea.exe', display: 'IntelliJ IDEA', category: 'work' },
  { process: 'pycharm64.exe', display: 'PyCharm', category: 'work' },
  { process: 'webstorm64.exe', display: 'WebStorm', category: 'work' },
  { process: 'devenv.exe', display: 'Visual Studio', category: 'work' },
  { process: 'WINWORD.EXE', display: 'Word', category: 'work' },
  { process: 'EXCEL.EXE', display: 'Excel', category: 'work' },
  { process: 'POWERPNT.EXE', display: 'PowerPoint', category: 'work' },
  { process: 'ONENOTE.EXE', display: 'OneNote', category: 'work' },
  { process: 'Typora.exe', display: 'Typora', category: 'work' },
  { process: 'Obsidian.exe', display: 'Obsidian', category: 'work' },
  { process: 'Notion.exe', display: 'Notion', category: 'work' },
  { process: 'WindowsTerminal.exe', display: 'Terminal', category: 'work' },
  { process: 'powershell.exe', display: 'PowerShell', category: 'work' },
  { process: 'pwsh.exe', display: 'PowerShell', category: 'work' },
  { process: 'cmd.exe', display: 'CMD', category: 'work' },
  { process: 'wsl.exe', display: 'WSL', category: 'work' },
  { process: 'git-bash.exe', display: 'Git Bash', category: 'work' },

  // ===== 摸鱼 entertainment =====
  { process: 'PotPlayerMini64.exe', display: 'PotPlayer', category: 'entertainment' },
  { process: 'PotPlayerMini.exe', display: 'PotPlayer', category: 'entertainment' },
  { process: 'vlc.exe', display: 'VLC', category: 'entertainment' },
  { process: 'cloudmusic.exe', display: '网易云音乐', category: 'entertainment' },
  { process: 'QQMusic.exe', display: 'QQ音乐', category: 'entertainment' },
  { process: 'Spotify.exe', display: 'Spotify', category: 'entertainment' },
  { process: 'steam.exe', display: 'Steam', category: 'entertainment' },
  { process: 'EpicGamesLauncher.exe', display: 'Epic', category: 'entertainment' },
  { process: 'bilibili.exe', display: '哔哩哔哩', category: 'entertainment' },

  // ===== 中性 neutral =====
  { process: 'msedge.exe', display: 'Microsoft Edge', category: 'neutral' },
  { process: 'chrome.exe', display: 'Google Chrome', category: 'neutral' },
  { process: 'firefox.exe', display: 'Firefox', category: 'neutral' },
  { process: 'explorer.exe', display: '文件资源管理器', category: 'neutral' },
  { process: 'WeChat.exe', display: '微信', category: 'neutral' },
  { process: 'QQ.exe', display: 'QQ', category: 'neutral' },
  { process: 'Telegram.exe', display: 'Telegram', category: 'neutral' },
  { process: 'DingTalk.exe', display: '钉钉', category: 'neutral' },
  { process: 'Feishu.exe', display: '飞书', category: 'neutral' },
  { process: 'SnippingTool.exe', display: '截图工具', category: 'neutral' },
  { process: 'mstsc.exe', display: '远程桌面', category: 'neutral' },

  // ===== 黑名单（完全不记录） =====
  { process: 'svchost.exe', display: 'svchost', category: 'neutral', blacklist: true },
  { process: 'System', display: 'System', category: 'neutral', blacklist: true },
  { process: 'Registry', display: 'Registry', category: 'neutral', blacklist: true },
  { process: 'dwm.exe', display: 'dwm', category: 'neutral', blacklist: true },
  { process: 'conhost.exe', display: 'conhost', category: 'neutral', blacklist: true },
  { process: 'SearchHost.exe', display: 'SearchHost', category: 'neutral', blacklist: true },
  { process: 'StartMenuExperienceHost.exe', display: 'StartMenu', category: 'neutral', blacklist: true },
  { process: 'TextInputHost.exe', display: 'TextInput', category: 'neutral', blacklist: true },
  { process: 'ApplicationFrameHost.exe', display: 'AppFrame', category: 'neutral', blacklist: true }
]

/** 写入默认应用映射表（仅首次，已存在的不覆盖） */
export function seedAppMappings(): void {
  const stmt = getDb().prepare(
    'INSERT OR IGNORE INTO app_mappings (process_name, display_name, category, is_blacklist) VALUES (?, ?, ?, ?)'
  )
  try {
    for (const m of DEFAULT_MAPPINGS) {
      stmt.run([
        m.process,
        m.display,
        m.category,
        m.blacklist ? 1 : 0
      ])
    }
  } finally {
    stmt.free()
  }
}

// 内存缓存，避免每次采集都查库
const mappingCache = new Map<string, AppMapping>()

/** 查询应用映射（大小写不敏感，未命中返回默认中性值）
 *  若命中的 display_name 为空串（历史脏数据），用 process_name 去 .exe 后缀兜底 */
export function lookupApp(processName: string): AppMapping {
  if (!processName) {
    return { displayName: '未知', category: 'neutral', isBlacklist: false }
  }

  const lower = processName.toLowerCase()
  if (mappingCache.has(lower)) {
    return mappingCache.get(lower)!
  }

  // 兜底显示名：process_name 去掉扩展名（如 chrome.exe -> chrome）
  const fallbackDisplay = processName.replace(/\.[^.]+$/, '')

  const stmt = getDb().prepare(
    'SELECT display_name, category, is_blacklist FROM app_mappings WHERE lower(process_name) = ?'
  )
  let result: AppMapping
  try {
    stmt.bind([lower])
    if (stmt.step()) {
      const row = stmt.getAsObject() as {
        display_name: string
        category: AppMapping['category']
        is_blacklist: number
      }
      // 命中但 display_name 为空串（历史脏数据）→ 用 process_name 兜底，避免返回空名
      const displayName = row.display_name && row.display_name.trim()
        ? row.display_name
        : fallbackDisplay
      result = {
        displayName,
        category: row.category,
        isBlacklist: row.is_blacklist === 1
      }
    } else {
      // 主进程名未命中：尝试去掉 .exe 后缀再次匹配（用户设置页可能不写后缀）
      const withoutExe = lower.replace(/\.exe$/i, '')
      if (withoutExe !== lower) {
        stmt.reset()
        stmt.bind([withoutExe])
        if (stmt.step()) {
          const row = stmt.getAsObject() as {
            display_name: string
            category: AppMapping['category']
            is_blacklist: number
          }
          const displayName = row.display_name && row.display_name.trim()
            ? row.display_name
            : fallbackDisplay
          result = {
            displayName,
            category: row.category,
            isBlacklist: row.is_blacklist === 1
          }
        } else {
          result = { displayName: fallbackDisplay, category: 'neutral', isBlacklist: false }
        }
      } else {
        result = { displayName: fallbackDisplay, category: 'neutral', isBlacklist: false }
      }
    }
  } finally {
    stmt.free()
  }

  mappingCache.set(lower, result)
  return result
}

/** 启动时一次性修复历史脏数据：
 *  1) app_mappings 表里 display_name 为空/NULL 的行，用 process_name 去 .exe 补上
 *  2) window_sessions 表里 app_display_name 为空/NULL 的行，用 process_name 去 .exe 补上
 *  修复后这些字段不再为空，避免 top5 显示"无名的干活" */
export function repairEmptyDisplayNames(): void {
  // 修 app_mappings
  const fixMappings = getDb().prepare(
    `UPDATE app_mappings SET display_name = replace(process_name, '.exe', '')
     WHERE display_name IS NULL OR display_name = ''`
  )
  try {
    fixMappings.step()
  } finally {
    fixMappings.free()
  }

  // 修 window_sessions
  const fixSessions = getDb().prepare(
    `UPDATE window_sessions SET app_display_name = replace(process_name, '.exe', '')
     WHERE app_display_name IS NULL OR app_display_name = ''`
  )
  try {
    fixSessions.step()
  } finally {
    fixSessions.free()
  }
}

/** 清除内存缓存（设置页修改映射后调用） */
export function clearMappingCache(): void {
  mappingCache.clear()
}

/** 查询全部应用映射（设置页黑名单管理用） */
export function getAllAppMappings(): AppMappingRow[] {
  const stmt = getDb().prepare(
    'SELECT process_name, display_name, category, is_blacklist FROM app_mappings ORDER BY is_blacklist DESC, display_name ASC'
  )
  const rows: AppMappingRow[] = []
  try {
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as AppMappingRow)
    }
    return rows
  } finally {
    stmt.free()
  }
}

/** 更新某进程的黑名单标记（修改后需 clearMappingCache） */
export function setAppBlacklist(processName: string, isBlacklist: boolean): void {
  const stmt = getDb().prepare(
    'UPDATE app_mappings SET is_blacklist = ? WHERE process_name = ?'
  )
  try {
    stmt.bind([isBlacklist ? 1 : 0, processName])
    stmt.step()
  } finally {
    stmt.free()
  }
}

/** 新增或更新应用映射（UPSERT）。修改后需 clearMappingCache
 *  displayName 为空串时保留旧值（避免 updateCategory 把已有 display_name 清空） */
export function upsertAppMapping(
  processName: string,
  displayName: string,
  category: AppMapping['category']
): void {
  const stmt = getDb().prepare(
    `INSERT INTO app_mappings (process_name, display_name, category, is_blacklist)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(process_name) DO UPDATE SET
       display_name = CASE WHEN excluded.display_name = '' THEN app_mappings.display_name ELSE excluded.display_name END,
       category = excluded.category`
  )
  try {
    stmt.bind([processName, displayName, category])
    stmt.step()
  } finally {
    stmt.free()
  }
}

/** 将应用映射的变更同步到历史 window_sessions（display_name + category） */
export function syncMappingsToHistory(processName: string): void {
  const stmt = getDb().prepare(
    `UPDATE window_sessions SET
       app_display_name = COALESCE(
         NULLIF((SELECT display_name FROM app_mappings WHERE lower(app_mappings.process_name) IN (lower(window_sessions.process_name), lower(replace(window_sessions.process_name, '.exe', '')))), ''),
         app_display_name
       ),
       app_category = COALESCE(
         (SELECT category FROM app_mappings WHERE lower(app_mappings.process_name) IN (lower(window_sessions.process_name), lower(replace(window_sessions.process_name, '.exe', '')))),
         app_category
       )
     WHERE lower(process_name) IN (lower(?), lower(? || '.exe'))`
  )
  try {
    const pn = processName.replace(/\.exe$/i, '')
    stmt.bind([processName, pn])
    stmt.step()
  } finally {
    stmt.free()
  }

  // 兜底修复：把已损坏的空 display_name 用 process_name 恢复
  const repair = getDb().prepare(
    `UPDATE window_sessions SET app_display_name = replace(process_name, '.exe', '')
     WHERE (app_display_name = '' OR app_display_name IS NULL)
       AND lower(process_name) IN (lower(?), lower(? || '.exe'))`
  )
  try {
    repair.bind([processName, processName.replace(/\.exe$/i, '')])
    repair.step()
  } finally {
    repair.free()
  }
}
