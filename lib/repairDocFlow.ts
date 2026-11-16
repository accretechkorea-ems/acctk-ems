'use client'

// 수리내역서를 **여는 한 가지 길** — 목록 세 곳이 함께 쓴다.
//
// ── 공구 아이콘을 누르면 ────────────────────────────────────────────────────
//   아직 적은 것이 없으면   → 작성 모달이 열린다(여기 오지 않는다).
//   적어 둔 것이 있으면     → **수리내역서 PDF 가 먼저** 열리고, 그 뷰어의 「정보 수정」이
//                            작성 모달로 보낸다. 고치고 저장하면 다시 이 함수로 돌아온다.
//
//   적어 둔 건을 다시 볼 때 사람이 보고 싶은 것은 **완성된 문서**다. 작성 칸을 먼저 펼치면
//   확인만 하려던 사람이 매번 한 번 더 닫아야 한다.
//
// ── 열 때마다 **다시 그린다** ───────────────────────────────────────────────
//   버킷에 있는 파일을 그대로 열면, 수리 정보·사진·품목이 그 뒤에 바뀐 건은 **옛 문서**가
//   열린다. 고객에게 나가는 서류라 「지금 자료와 다를 수 있다」는 여지를 두지 않는다.
//   그리는 데 시간이 걸리므로(20초쯤) 부르는 쪽이 아이콘에 도는 표시를 낸다.

import { generateQuoteDoc } from '@/lib/quoteDocGenerate'
import { openPdf, shouldUseNewTab } from '@/lib/pdfViewer'

export type RepairDocToast = { success: (m: string) => void; error: (m: string) => void }

export type OpenRepairDocInput = {
  quoteId: number
  toast: RepairDocToast
  /** 뷰어의 「정보 수정」이 부를 함수 — 작성 모달을 연다. */
  onEdit: () => void
}

export async function openRepairDoc({ quoteId, toast, onEdit }: OpenRepairDocInput): Promise<void> {
  // 만드는 데 시간이 걸리면 그 사이 사용자 제스처가 끊긴다 — 새 탭으로 갈 자리면 미리 연다.
  const tab = shouldUseNewTab() ? window.open('', '_blank') : null
  const r = await generateQuoteDoc(quoteId, 'repair')
  if (!r.ok) {
    tab?.close()
    toast.error(r.error)
    return
  }
  openPdf({ url: r.url, name: r.name, action: { label: '정보 수정', onClick: onEdit } }, tab)
}
