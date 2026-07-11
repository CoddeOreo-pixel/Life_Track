import koffi from 'koffi'
import { Buffer } from 'buffer'

// Windows 前台窗口信息获取（通过 koffi 调用 user32/kernel32，无需编译）
// koffi 为预编译 FFI 库，不依赖 Visual Studio

interface WinFuncs {
  GetForegroundWindow: () => unknown
  GetWindowTextW: (hWnd: unknown, buf: unknown, max: number) => number
  GetWindowThreadProcessId: (hWnd: unknown, pidPtr: unknown) => number
  OpenProcess: (access: number, inherit: number, pid: number) => unknown
  QueryFullProcessImageNameW: (
    hProcess: unknown,
    flags: number,
    buf: unknown,
    sizePtr: unknown
  ) => number
  CloseHandle: (h: unknown) => number
}

let funcs: WinFuncs | null = null

function loadLibs(): WinFuncs {
  if (funcs) return funcs
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  funcs = {
    GetForegroundWindow: user32.func('void *GetForegroundWindow()') as never,
    GetWindowTextW: user32.func(
      'int GetWindowTextW(void *hWnd, uint16_t *lpString, int nMaxCount)'
    ) as never,
    GetWindowThreadProcessId: user32.func(
      'uint32 GetWindowThreadProcessId(void *hWnd, uint32_t *lpdwProcessId)'
    ) as never,
    OpenProcess: kernel32.func(
      'void *OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)'
    ) as never,
    QueryFullProcessImageNameW: kernel32.func(
      'int QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, uint16_t *lpExeName, uint32_t *lpcbSize)'
    ) as never,
    CloseHandle: kernel32.func('int CloseHandle(void *hObject)') as never
  }
  return funcs
}

export interface ForegroundWindow {
  title: string
  processName: string // 如 "Code.exe"
  processPath: string
  pid: number
}

/** 把 uint16_t 数组解码为 UTF-16 字符串（用 Node Buffer +ucs2，避开 koffi decode API 差异） */
function decodeUtf16(uint16Ptr: unknown, len: number): string {
  if (len <= 0) return ''
  // koffi pointer 转为底层字节
  const u8 = koffi.decode(uint16Ptr, 'uint8_t', len * 2) as Uint8Array
  return Buffer.from(u8).toString('ucs2')
}

/** 获取当前前台窗口信息，失败或无前台窗口返回 null */
export function getForegroundWindow(): ForegroundWindow | null {
  try {
    const f = loadLibs()
    const hwnd = f.GetForegroundWindow()
    if (!hwnd) return null

    // 窗口标题
    const titleBuf = koffi.alloc('uint16_t', 512)
    const titleLen = f.GetWindowTextW(hwnd, titleBuf, 512)
    const title = decodeUtf16(titleBuf, titleLen)

    // 进程 PID
    const pidPtr = koffi.alloc('uint32_t', 1)
    f.GetWindowThreadProcessId(hwnd, pidPtr)
    // koffi 指针不支持 [index] 语法，必须用 koffi.decode 读取
    const pid = koffi.decode(pidPtr, 'uint32_t', 1)[0] as number
    if (!pid) return null

    // 进程完整路径（用 LIMITED_INFORMATION 权限，无需管理员）
    let processPath = ''
    const handle = f.OpenProcess(0x1000, 0, pid) // PROCESS_QUERY_LIMITED_INFORMATION
    if (handle) {
      const pathBuf = koffi.alloc('uint16_t', 1024)
      const sizePtr = koffi.alloc('uint32_t', 1)
      // koffi 指针不支持 [index] 赋值，必须用 koffi.encode 写入（参数为单个值）
      koffi.encode(sizePtr, 'uint32_t', 1024)
      const ok = f.QueryFullProcessImageNameW(handle, 0, pathBuf, sizePtr)
      if (ok) {
        const size = koffi.decode(sizePtr, 'uint32_t', 1)[0] as number
        processPath = decodeUtf16(pathBuf, size)
      }
      f.CloseHandle(handle)
    }

    const processName = processPath
      ? processPath.split(/[\\/]/).pop() || ''
      : ''

    return { title, processName, processPath, pid }
  } catch (err) {
    console.error('[Life_Track] 获取前台窗口失败:', err)
    return null
  }
}
