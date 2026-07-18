import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import Today from './routes/Today'
import Weekly from './routes/Weekly'
import Monthly from './routes/Monthly'
import Timeline from './routes/Timeline'
import Settings from './routes/Settings'

const navItems = [
  { path: '/today', label: '今日', prefix: '$ cd ~/' },
  { path: '/weekly', label: '周报', prefix: '$ cd ~/' },
  { path: '/monthly', label: '月报', prefix: '$ cd ~/' },
  { path: '/timeline', label: '时间线', prefix: '$ cd ~/' },
  { path: '/settings', label: '设置', prefix: '$ cd ~/' }
]

export default function App() {
  const [flushError, setFlushError] = useState('')

  useEffect(() => {
    const unsub = window.lifeTrack.on('db:flush-error', (msg: unknown) => {
      setFlushError(typeof msg === 'string' ? msg : '')
    })
    return () => { unsub() }
  }, [])

  return (
    <div className="app-layout">
      <aside className="sidebar grid-dense">
        <div className="sidebar-logo">
          LIFE<span className="accent">_</span>TRACK
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                'nav-item' + (isActive ? ' active' : '')
              }
            >
              <span className="nav-prefix">{item.prefix}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot"></span>
          采集中 · v0.1.3
        </div>
      </aside>
      <main className="main-content grid-sparse">
        {flushError && (
          <div className="flush-error-banner">
            数据持久化失败：{flushError}（数据仍保留在内存中，重启应用将丢失）
          </div>
        )}
        <Routes>
          <Route path="/today" element={<Today />} />
          <Route path="/weekly" element={<Weekly />} />
          <Route path="/monthly" element={<Monthly />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
    </div>
  )
}
