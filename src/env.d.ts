/// <reference types="vite/client" />

// 声明 SQL 原始字符串导入
declare module '*.sql?raw' {
  const content: string
  export default content
}

// 引用 preload 导出的类型，做全局 Window 增强
import type { LifeTrackApi } from '../electron/preload'

declare global {
  interface Window {
    lifeTrack: LifeTrackApi
  }
}
