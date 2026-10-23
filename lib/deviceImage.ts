// 장비 사진 — **버킷 안의 경로만** 저장하고, 보여 줄 때 서명 URL 을 받는다.
//
// device-images 버킷은 2026-10-23 까지 **공개**였다(인증 없이 HTTP 200 — 주소만 알면
// 밖에서 열렸다. docs/audit-2026-10.md 의 위험 6번). 고객 장비 사진이라 비공개로 돌린다.
//
//   저장 — 파일 이름만(예: device-110-1792465305624.jpg)
//   표시 — /api/device-image 가 1시간 서명 URL 을 준다(hooks/useStorageImageUrls.ts)
//
// ── 버킷에 든 두 가지 ───────────────────────────────────────────────────────
//   device-*  — 사람이 올린 **고객 장비 사진**. devices.image_url 이 가리킨다(34행).
//   default_* — 기종별 **제품 카탈로그 사진**(17장). DB 가 가리키지 않고
//               components/customer/utils.ts 의 규칙표가 파일 이름을 만든다.
//
// 둘 다 라우트를 지나게 했다. 카탈로그 사진은 고객 자료가 아니라 공개여도 무해하지만,
// 묶음 조회(POST paths[]) 덕에 요청이 늘지 않으므로 나눌 이유가 없다 — 버킷 하나만
// 비공개로 돌리면 끝난다.
//
// 순수 함수만 둔다 — 하네스(scripts/device-image-check.js)가 그대로 돌린다.

import { isSafeStorageName, storageObjectPath } from '@/lib/storagePath'

/** 사진이 사는 버킷. */
export const DEVICE_BUCKET = 'device-images'

/**
 * 받을 수 있는 변환 폭. 라우트가 이 목록 안의 값만 받는다
 * (아무 숫자나 받으면 변환 캐시가 쓸데없이 갈라진다).
 *
 *   240 — 목록 카드(고객사 상세 장비·쇼룸 카드). 지금 카드 폭이 그만큼이다.
 *   480 — 조금 큰 자리·고해상도 화면.
 *   원본 — 수정 모달의 미리보기. 폭을 주지 않으면 원본을 서명한다.
 */
export const DEVICE_IMAGE_WIDTHS = [240, 480] as const
export type DeviceImageWidth = (typeof DEVICE_IMAGE_WIDTHS)[number]

/** css 크기 → 받을 변환 폭. 2배수로 올려 잡고 목록 안으로 맞춘다. */
export function deviceImageWidthFor(cssWidth: number): DeviceImageWidth {
  const want = cssWidth * 2
  return DEVICE_IMAGE_WIDTHS.find(w => w >= want) ?? DEVICE_IMAGE_WIDTHS[DEVICE_IMAGE_WIDTHS.length - 1]
}

/** 저장된 값(경로·옛 공개 주소·서명 주소) → 버킷 안의 경로. 우리 버킷이 아니면 null. */
export const deviceImagePath = (stored: string | null | undefined): string | null =>
  storageObjectPath(stored, DEVICE_BUCKET)

/** 라우트가 받아도 되는 이름인가. */
export const isSafeDeviceImageName = isSafeStorageName

/**
 * 기종별 카탈로그 사진인가.
 *
 * DB 가 가리키지 않는 파일이라 「devices 어딘가가 쓰는 경로」 검사로는 통과하지 못한다.
 * 이름 규칙으로 가른다 — `default_` 로 시작하는 그림 파일. 버킷 하나 안으로 한정되고
 * 로그인한 직원만 부를 수 있으므로, 그 안에서 카탈로그 사진을 보는 것은 의도한 일이다.
 */
export function isDefaultDeviceImage(name: string): boolean {
  return /^default_[A-Za-z0-9]+\.(jpg|jpeg|png|webp|gif)$/i.test(name)
}

/** 올릴 파일 이름 — 장비마다 한 장이지만 이름에 시각을 넣는다(옛 사진이 캐시에 남지 않게). */
export function deviceImageFileName(deviceId: number, originalName: string, now: number): string {
  const ext = (originalName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg'
  return `device-${deviceId}-${now}.${safeExt}`
}
