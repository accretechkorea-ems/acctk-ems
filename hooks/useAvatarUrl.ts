'use client'

// 프로필 사진 한 장의 **보여 줄 주소**를 받아 온다.
//
//   const { url } = useAvatarUrl(engineer.profile_image_url, 72)
//
// 버킷이 비공개라 주소를 화면에서 만들 수 없다 — /api/profile-image 가 1시간 서명 URL 을
// 준다(lib/profileImage.ts 머리말). 그 왕복을 사람마다 한 번만 하도록 **모듈 수준에 캐시**한다
// (lib/teamPerms.ts·lib/appData/me.ts 와 같은 방식 — 약속을 캐시하므로 동시에 여러 자리에서
// 같은 사람을 그려도 요청은 하나다).
//
// 서명 URL 은 1시간이면 끝난다. 화면을 하루 종일 열어 두는 사람이 있으므로 만료 5분 전부터는
// 캐시를 버리고 다시 받는다 — 그러지 않으면 오후에 사진이 조용히 깨진다.

import { useEffect, useState } from 'react'
import { avatarWidthFor, profileImagePath, type AvatarWidth } from '@/lib/profileImage'

type Entry = { promise: Promise<string | null>; until: number }

/** `경로|폭` → 받아 둔(또는 받는 중인) 주소. 페이지가 살아 있는 동안만 산다. */
const cache = new Map<string, Entry>()
/** 만료 5분 전부터는 새로 받는다. */
const RENEW_MS = 5 * 60 * 1000

/** 권한·세션이 바뀌면 버린다(로그아웃 등). 지금은 쓰는 곳이 없지만 규칙을 맞춰 둔다. */
export function invalidateAvatars(): void {
  cache.clear()
}

/** 한 장의 서명 URL 을 받는다(캐시를 지난다). */
export function loadAvatarUrl(stored: string | null | undefined, width: AvatarWidth): Promise<string | null> {
  const path = profileImagePath(stored)
  if (!path) return Promise.resolve(null)
  const key = `${path}|${width}`
  const hit = cache.get(key)
  if (hit && hit.until - Date.now() > RENEW_MS) return hit.promise

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(`/api/profile-image?path=${encodeURIComponent(path)}&w=${width}`)
      if (!res.ok) {
        // 404 는 「그 경로를 쓰는 사람이 없다」다 — 지운 사진이거나 값이 낡은 것이다.
        console.warn('[avatar] 주소를 받지 못했다', res.status)
        cache.delete(key)
        return null
      }
      const json = await res.json() as { signedUrl?: string; expiresIn?: number }
      if (!json.signedUrl) { cache.delete(key); return null }
      const entry = cache.get(key)
      if (entry) entry.until = Date.now() + (json.expiresIn ?? 3600) * 1000
      return json.signedUrl
    } catch (e) {
      console.warn('[avatar] 주소를 받지 못했다', e)
      cache.delete(key)
      return null
    }
  })()

  // 만료 시각은 응답을 받은 뒤에 고쳐 넣는다. 그 전에는 1시간으로 잡아 둔다.
  cache.set(key, { promise, until: Date.now() + 3600 * 1000 })
  return promise
}

/**
 * 프로필 사진 주소.
 *
 * @param stored  engineers.profile_image_url 의 값. 경로여도 옛 공개 URL 이어도 된다.
 * @param cssSize 화면에 그릴 지름(px). 받아 올 변환 폭을 이 값으로 정한다(2배수).
 */
export function useAvatarUrl(stored: string | null | undefined, cssSize: number): { url: string | null; loading: boolean } {
  const path = profileImagePath(stored)
  const width = avatarWidthFor(cssSize)
  const key = path ? `${path}|${width}` : ''
  /**
   * 받아 둔 주소와 **그것이 어느 열쇠의 것인지**를 함께 들고 있다.
   *
   * loading 을 따로 두지 않는 이유 — effect 안에서 곧바로 setState 하면 렌더가 한 번 더 돌고,
   * 사진이 바뀌는 순간 옛 주소가 한 프레임 보인다. 열쇠를 비교해 **계산해서** 쓰면 둘 다 없다.
   */
  const [got, setGot] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!key || !path) return
    let alive = true
    loadAvatarUrl(path, width).then(url => { if (alive) setGot({ key, url }) })
    return () => { alive = false }
  }, [key, path, width])

  if (!key) return { url: null, loading: false }
  if (got?.key !== key) return { url: null, loading: true }
  return { url: got.url, loading: false }
}
