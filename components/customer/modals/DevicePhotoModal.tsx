'use client'

/**
 * 장비 사진 **크게 보기** — 사진만 띄운다 (2026-11-25).
 *
 * ── 왜 창을 따로 두는가 ───────────────────────────────────────────────────
 *   전에는 카드의 사진을 누르면 **사진 등록 창**이 떴다(DeviceImageModal). 보려고 누른
 *   사람이 올리는 창을 만나는 자리였다. 이제 누르면 **보이기만** 하고, 올리고 바꾸고
 *   지우는 일은 장비 수정 창 한 곳에 있다(components/customer/modals/DeviceEditModal.tsx).
 *
 * ── 큰 그림은 **열 때 받는다** ─────────────────────────────────────────────
 *   카드가 들고 있는 주소는 폭 480 로 변환한 썸네일이다 — 그것을 그대로 띄우면 1440
 *   화면에서 480px 짜리가 가운데 작게 놓인다(2026-11-25 실측). 그래서 창은 **저장된
 *   경로**를 받아 원본 주소를 따로 받는다(useDeviceImageUrls 의 폭 없는 쪽). 받는 동안은
 *   카드의 썸네일을 그대로 보여 준다 — 빈 화면을 지나지 않는다.
 *
 * ── 공용 카드(ModalCard)를 쓰지 않는 까닭 ─────────────────────────────────
 *   머리줄·본문·바닥줄이 없다 — 사진 한 장이 전부다. 카드 껍데기를 두르면 흰 테가
 *   사진을 가둬 「크게 보기」가 아니게 된다. 닫는 길(Esc·바깥 클릭)과 층은 공용
 *   오버레이가 그대로 맡는다(겹친 창의 Esc 순서도 거기서 지킨다).
 *   명함 크게 보기(app/leads)와 같은 모양이고, 하네스가 이 둘을 라이트박스로 적어 둔다
 *   (scripts/modal-shell-check.js 의 ⑥).
 */

import ModalOverlay from '@/components/common/ModalOverlay'
import { useDeviceImageUrls } from '@/hooks/useStorageImageUrls'
import { Z } from '@/lib/zIndex'
import { R } from '@/lib/radius'
import { CARD_BG } from '@/components/common/ui'

/** 사진이 쓸 수 있는 자리 — 화면의 90%. 그 안에서 비율을 지킨다(contain). */
const FIT = '90'

export default function DevicePhotoModal({
  photo, onClose,
}: {
  /**
   * 보고 있는 사진. null 이면 창을 띄우지 않는다.
   *   path    저장된 값(버킷 안 경로) — 원본 주소를 받는 열쇠다.
   *   preview 카드가 이미 들고 있는 썸네일 주소 — 원본이 오기 전까지 이것을 띄운다.
   */
  photo: { path: string; preview: string; alt: string } | null
  onClose: () => void
}) {
  // 훅은 창이 닫혀 있어도 돈다(조건부로 부르지 않는다) — 빈 목록이면 아무것도 받지 않는다.
  const full = useDeviceImageUrls(photo ? [photo.path] : [])
  if (!photo) return null
  const src = full(photo.path) ?? photo.preview

  return (
    <ModalOverlay onClose={onClose}
      style={{
        zIndex: Z.modal, alignItems: 'center', justifyContent: 'center',
        padding: '5vh 5vw', overflow: 'hidden', cursor: 'zoom-out',
      }}>
      {/* 저장소(Supabase)의 사진이라 next/image 를 쓰지 않는다(원격 도메인 설정이 필요하고,
          한 장을 크게 보는 이 자리에 최적화의 이득이 없다). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={photo.alt}
        style={{
          maxWidth: `${FIT}vw`, maxHeight: `${FIT}vh`, objectFit: 'contain',
          borderRadius: R.control, background: CARD_BG, cursor: 'default',
        }} />
    </ModalOverlay>
  )
}
