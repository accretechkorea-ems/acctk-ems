'use client'

// 비공개 버킷의 사진 **여러 장**의 주소를 한 번에 받아 온다.
//
//   const url = useDeviceImageUrls(paths, 240)
//   <img src={url(device.image_url) ?? ''} />
//
// 왜 묶음인가 — 쇼룸 한 화면에 카드가 여덟 장, 고객사 상세에는 수십 장이다. 장마다 서명을
// 받으면 요청이 그만큼 늘어난다(docs/perf/baseline-browser.md 의 쇼룸 항목이 그래서 21건
// 이었다). 라우트가 POST paths[] 를 받으므로 **화면당 한 번**이면 된다.
//
// 캐시는 모듈 수준이다(lib/teamPerms.ts·lib/appData/me.ts 와 같은 방식) — 같은 경로는
// 세션 동안 한 번만 받는다. 서명은 1시간이라 만료 5분 전부터 다시 받는다.

import { useEffect, useState } from 'react'
import { deviceImagePath, type DeviceImageWidth } from '@/lib/deviceImage'

type Entry = { url: string; until: number }

/** `경로|폭` → 받아 둔 주소. 페이지가 살아 있는 동안만 산다. */
const cache = new Map<string, Entry>()
/** 만료 5분 전부터는 새로 받는다. */
const RENEW_MS = 5 * 60 * 1000
/** 같은 묶음을 두 번 묻지 않게, 지금 받는 중인 약속을 모아 둔다. */
const inflight = new Map<string, Promise<void>>()

/** 권한·세션이 바뀌면 버린다(로그아웃 등). */
export function invalidateStorageImages(): void {
  cache.clear()
  inflight.clear()
}

const keyOf = (path: string, width: number | null) => `${path}|${width ?? 'orig'}`

const fresh = (path: string, width: number | null): string | null => {
  const hit = cache.get(keyOf(path, width))
  return hit && hit.until - Date.now() > RENEW_MS ? hit.url : null
}

/** 모르는 경로만 한 번에 받아 캐시에 담는다. */
async function fetchMissing(paths: string[], width: number | null): Promise<void> {
  const missing = paths.filter(p => !fresh(p, width))
  if (missing.length === 0) return
  const batchKey = `${width ?? 'orig'}|${[...missing].sort().join(',')}`
  const running = inflight.get(batchKey)
  if (running) return running

  const promise = (async () => {
    try {
      const res = await fetch('/api/device-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: missing, w: width ?? undefined }),
      })
      if (!res.ok) { console.warn('[deviceImage] 주소를 받지 못했다', res.status); return }
      const json = await res.json() as { urls?: Record<string, string>; expiresIn?: number }
      const until = Date.now() + (json.expiresIn ?? 3600) * 1000
      for (const [path, url] of Object.entries(json.urls ?? {})) cache.set(keyOf(path, width), { url, until })
    } catch (e) {
      console.warn('[deviceImage] 주소를 받지 못했다', e)
    } finally {
      inflight.delete(batchKey)
    }
  })()
  inflight.set(batchKey, promise)
  return promise
}

/** 저장된 값(경로·옛 공개 주소) → 보여 줄 주소. 아직 못 받았으면 null. */
export type StorageImageLookup = (stored: string | null | undefined) => string | null

/**
 * 장비 사진 주소 여러 장.
 *
 * @param stored 저장된 값들(경로여도 옛 공개 주소여도 된다). 빈 값은 걸러진다.
 * @param width  받을 변환 폭. 주지 않으면 원본을 받는다(수정 모달의 미리보기).
 */
export function useDeviceImageUrls(
  stored: readonly (string | null | undefined)[],
  width?: DeviceImageWidth,
): StorageImageLookup {
  const w = width ?? null
  const paths = [...new Set(stored.map(deviceImagePath).filter((p): p is string => !!p))].sort()
  // 목록을 글자로 눕힌다 — 배열은 매 렌더 새 객체라 그대로 쓰면 effect 가 끝없이 돈다.
  const signature = paths.join(',')
  /**
   * 「몇 번 받아 왔는가」만 들고 있다. 주소 자체는 모듈 캐시에 있다 —
   * effect 안에서 곧바로 setState 하지 않으려고(렌더가 한 번 더 돌고 그림이 깜빡인다)
   * 받아 온 뒤에만 이 수를 올린다.
   */
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!signature) return
    let alive = true
    fetchMissing(signature.split(','), w).then(() => { if (alive) setTick(t => t + 1) })
    return () => { alive = false }
  }, [signature, w])

  return (value) => {
    const path = deviceImagePath(value)
    if (!path) return null
    return cache.get(keyOf(path, w))?.url ?? null
  }
}
