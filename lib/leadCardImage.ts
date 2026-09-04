'use client'

import { CARD_MAX_EDGE, CARD_JPEG_QUALITY } from '@/lib/leadOptions'

/**
 * 명함 사진을 브라우저에서 줄인다. 원본은 서버로 보내지 않는다 —
 * 폰으로 찍은 사진이 5~12MB 나 되어 공개 폼으로 그대로 올라오면 회선도 스토리지도 감당이 안 된다.
 *
 * 새 라이브러리 없이 canvas 만 쓴다. EXIF 회전은 createImageBitmap 의
 * imageOrientation: 'from-image' 가 처리한다 — 이것이 없으면 세로로 찍은 사진이 눕는다.
 * (createImageBitmap 이 없는 오래된 브라우저에서는 <img> 로 대체한다. 요즘 브라우저는
 *  <img> 디코딩에도 EXIF 를 반영하므로 결과가 같다.)
 */

export type DownsizeResult = {
  /** data:image/jpeg;base64,... — 이대로 /api/lead 에 실어 보낸다 */
  dataUrl: string
  /** 줄이기 전 바이트 */
  before: number
  /** 줄인 뒤 바이트(디코딩 기준) */
  after: number
  width: number
  height: number
}

/** base64 부분의 실제 바이트 수. 패딩(=) 을 빼야 스토리지에 저장될 크기와 맞는다. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

type Drawable = { source: CanvasImageSource; width: number; height: number; close?: () => void }

async function decode(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') {
    // EXIF 회전을 반영해 디코딩한다. 이 옵션을 빼면 세로 사진이 눕는다.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight }
  } finally {
    // decode 가 끝나면 draw 까지 원본이 유지된다(브라우저가 디코딩 결과를 들고 있다).
    URL.revokeObjectURL(url)
  }
}

export async function downsizeImage(file: File): Promise<DownsizeResult> {
  const drawable = await decode(file)
  try {
    const { width: w0, height: h0 } = drawable
    if (!w0 || !h0) throw new Error('이미지 크기를 읽지 못했습니다')

    // 긴 변 기준으로만 줄인다. 원본이 더 작으면 확대하지 않는다.
    const scale = Math.min(1, CARD_MAX_EDGE / Math.max(w0, h0))
    const width = Math.round(w0 * scale)
    const height = Math.round(h0 * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 를 쓸 수 없습니다')
    // JPEG 는 투명을 지원하지 않아, PNG 원본의 투명 부분이 검게 나온다. 흰 바탕을 먼저 깐다.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(drawable.source, 0, 0, width, height)

    const dataUrl = canvas.toDataURL('image/jpeg', CARD_JPEG_QUALITY)
    if (!dataUrl.startsWith('data:image/jpeg')) throw new Error('이미지를 변환하지 못했습니다')

    const result: DownsizeResult = { dataUrl, before: file.size, after: dataUrlBytes(dataUrl), width, height }
    // 실제로 얼마나 줄었는지 남긴다(요구된 확인 항목).
    console.log('[명함] 다운사이징', {
      원본: `${w0}×${h0} ${(result.before / 1024).toFixed(0)}KB`,
      변환: `${width}×${height} ${(result.after / 1024).toFixed(0)}KB`,
      비율: `${((result.after / result.before) * 100).toFixed(1)}%`,
    })
    return result
  } finally {
    drawable.close?.()
  }
}
