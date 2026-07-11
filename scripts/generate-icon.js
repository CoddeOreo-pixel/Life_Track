/**
 * Life_Track 图标生成脚本
 * 从源 PNG (Life_Track.png) 生成：
 *   - build/icon.png  (1024x1024)
 *   - build/icon.ico  (256/64/48/32/16)
 *
 * 用法：node scripts/generate-icon.js
 * 纯 Node.js 实现，不依赖外部库。
 */

const fs = require('fs')
const zlib = require('zlib')

const SRC_PATH = 'Life_Track.png'
const OUT_PNG = 'build/icon.png'
const OUT_ICO = 'build/icon.ico'

// ====== PNG 解码（仅支持 8-bit RGBA 非交错的 PNG） ======

function parsePNG(buf) {
  // 校验签名
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw new Error('不是有效的 PNG 文件')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idatChunks = []

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart)
      height = buf.readUInt32BE(dataStart + 4)
      bitDepth = buf[dataStart + 8]
      colorType = buf[dataStart + 9]
    } else if (type === 'IDAT') {
      idatChunks.push(buf.slice(dataStart, dataStart + len))
    } else if (type === 'IEND') {
      break
    }

    offset = dataStart + len + 4 // 跳过 CRC
  }

  if (bitDepth !== 8) throw new Error(`仅支持 8-bit PNG，当前为 ${bitDepth}-bit`)
  if (colorType !== 6 && colorType !== 2) {
    throw new Error(`仅支持 RGBA(6) 或 RGB(2)，当前 colorType=${colorType}`)
  }

  const hasAlpha = colorType === 6
  const channels = hasAlpha ? 4 : 3

  // 解压所有 IDAT
  const compressed = Buffer.concat(idatChunks)
  const raw = zlib.inflateSync(compressed)

  // 反过滤
  const bpp = channels // bytes per pixel
  const stride = width * bpp
  const pixels = Buffer.alloc(height * stride)

  let rawPos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++]
    const rowStart = y * stride
    const row = raw.slice(rawPos, rawPos + stride)
    rawPos += stride

    const prevRowStart = (y - 1) * stride

    for (let x = 0; x < stride; x++) {
      let cur = row[x]
      const left = x >= bpp ? pixels[rowStart + x - bpp] : 0
      const up = y > 0 ? pixels[prevRowStart + x] : 0
      const upLeft = x >= bpp && y > 0 ? pixels[prevRowStart + x - bpp] : 0

      switch (filter) {
        case 0: // None
          break
        case 1: // Sub
          cur = (cur + left) & 0xff
          break
        case 2: // Up
          cur = (cur + up) & 0xff
          break
        case 3: // Average
          cur = (cur + ((left + up) >> 1)) & 0xff
          break
        case 4: // Paeth
          const p = left + up - upLeft
          const pa = Math.abs(p - left)
          const pb = Math.abs(p - up)
          const pc = Math.abs(p - upLeft)
          let pred
          if (pa <= pb && pa <= pc) pred = left
          else if (pb <= pc) pred = up
          else pred = upLeft
          cur = (cur + pred) & 0xff
          break
      }
      pixels[rowStart + x] = cur
    }
  }

  // 统一转成 RGBA
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels]
    rgba[i * 4 + 1] = pixels[i * channels + 1]
    rgba[i * 4 + 2] = pixels[i * channels + 2]
    rgba[i * 4 + 3] = hasAlpha ? pixels[i * channels + 3] : 255
  }

  return { width, height, data: rgba }
}

// ====== PNG 编码 ======

function crc32Table() {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
}

const CRC_TABLE = crc32Table()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crcData = Buffer.concat([t, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcData))
  return Buffer.concat([len, t, data, crcBuf])
}

function encodePNG(rgba, width, height) {
  // 每行加 filter byte (0 = None)
  const rawSize = height * (1 + width * 4)
  const raw = Buffer.alloc(rawSize)
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4)
    raw[rowOff] = 0
    for (let x = 0; x < width; x++) {
      const srcOff = (y * width + x) * 4
      const dstOff = rowOff + 1 + x * 4
      raw[dstOff] = rgba[srcOff]
      raw[dstOff + 1] = rgba[srcOff + 1]
      raw[dstOff + 2] = rgba[srcOff + 2]
      raw[dstOff + 3] = rgba[srcOff + 3]
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 })

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ====== 双线性缩放 ======

function resizeBilinear(src, srcW, srcH, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4)
  const xRatio = (srcW - 1) / dstW
  const yRatio = (srcH - 1) / dstH

  for (let y = 0; y < dstH; y++) {
    const sy = y * yRatio
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, srcH - 1)
    const dy = sy - y0

    for (let x = 0; x < dstW; x++) {
      const sx = x * xRatio
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, srcW - 1)
      const dx = sx - x0

      const i00 = (y0 * srcW + x0) * 4
      const i01 = (y0 * srcW + x1) * 4
      const i10 = (y1 * srcW + x0) * 4
      const i11 = (y1 * srcW + x1) * 4

      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - dx) + src[i01 + c] * dx
        const bot = src[i10 + c] * (1 - dx) + src[i11 + c] * dx
        dst[(y * dstW + x) * 4 + c] = Math.round(top * (1 - dy) + bot * dy)
      }
    }
  }

  return dst
}

// ====== 主流程 ======

console.log('读取源图:', SRC_PATH)
const srcBuf = fs.readFileSync(SRC_PATH)
const src = parsePNG(srcBuf)
console.log(`  源图尺寸: ${src.width}x${src.height}`)

// 1. 生成 1024x1024 PNG
console.log('生成 build/icon.png (1024x1024)...')
const png1024 = resizeBilinear(src.data, src.width, src.height, 1024, 1024)
const pngOut = encodePNG(png1024, 1024, 1024)
fs.writeFileSync(OUT_PNG, pngOut)
console.log(`  ✓ ${OUT_PNG} (${pngOut.length} bytes)`)

// 2. 生成 ICO（多尺寸）
console.log('生成 build/icon.ico...')
const sizes = [256, 64, 48, 32, 16]
const entries = []
let offset = 6 + sizes.length * 16

for (const s of sizes) {
  const scaled = resizeBilinear(src.data, src.width, src.height, s, s)
  const pngData = encodePNG(scaled, s, s)

  const header = Buffer.alloc(16)
  header.writeUInt8(s >= 256 ? 0 : s, 0) // width
  header.writeUInt8(s >= 256 ? 0 : s, 1) // height
  header.writeUInt8(0, 2) // palette
  header.writeUInt8(0, 3) // reserved
  header.writeUInt16LE(1, 4) // color planes
  header.writeUInt16LE(32, 6) // bits per pixel
  header.writeUInt32LE(pngData.length, 8) // size
  header.writeUInt32LE(offset, 12) // offset

  entries.push({ header, data: pngData })
  offset += pngData.length
}

const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0) // reserved
icoHeader.writeUInt16LE(1, 2) // type: ICO
icoHeader.writeUInt16LE(sizes.length, 4) // count

const ico = Buffer.concat([
  icoHeader,
  ...entries.map((e) => e.header),
  ...entries.map((e) => e.data)
])
fs.writeFileSync(OUT_ICO, ico)
console.log(`  ✓ ${OUT_ICO} (${ico.length} bytes)`)

console.log('\n完成！')
