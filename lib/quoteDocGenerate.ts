'use client'

// 거래명세서·수리내역서를 **만들어 올리고 열어 주는** 한 줄기.
//
//   자료 받기(doc-data) → 사진 줄이기 → PDF 그리기 → 올리기(doc-save) → 새 탭으로 열기
//
// 그리는 일은 화면에서 한다 — 견적서 PDF 와 같은 @react-pdf/renderer 다(서버에서 그리려면
// 글꼴·로고를 서버 경로로 다시 받아야 하고, 지금 견적서도 화면에서 그린다).
// 올리는 일만 서비스 롤 라우트가 한다 — 파일 이름을 서버가 정해야 남의 견적 번호로
// 덮어쓰는 길이 막힌다.

import { pdf } from '@react-pdf/renderer'
import { createElement } from 'react'
import TransactionPDFDoc from '@/components/pdf/TransactionPDFDoc'
import RepairReportPDFDoc from '@/components/pdf/RepairReportPDFDoc'
import {
  DOC_LABEL, contactLine, docNumber, officeTel, partRows, personLabel, transactionLines,
  workPeriod, modelOf, type DocItem, type DocRepair, type QuoteDocKind,
} from '@/lib/quoteDocs'
import { todayKST } from '@/lib/date'

/** PDF 에 넣기 전 사진을 한 번 더 줄인다 — 긴 변 1,000px · 품질 0.75. */
const PDF_PHOTO_EDGE = 1000
const PDF_PHOTO_QUALITY = 0.75

type DocData = {
  quote: {
    quote_id: number; quote_number: string; quote_date: string | null; status: string | null
    recipient: string | null; recipient_contact_id: number | null
  }
  customer: { company_name: string | null; address: string | null } | null
  contact: { name: string | null; position: string | null; phone: string | null } | null
  engineer: { name: string | null; position: string | null; tel: string | null; office: string | null } | null
  items: DocItem[]
  repair: (DocRepair & { serial_number: string | null; product_type: string | null; item_type: string | null }) | null
  info: { symptom: string | null; cause: string | null; result: string | null } | null
  photos: { photo_id: number; caption: string | null; url?: string | null }[]
}

async function fetchDocData(quoteId: number): Promise<DocData | null> {
  const res = await fetch('/api/quote-repair-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'doc-data', quoteId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) { console.error('[quoteDoc] 자료 조회 실패', { quoteId, error: json?.error }); return null }
  return json as DocData
}

/**
 * 저장된 사진을 **PDF 용으로 한 번 더 줄인다.** 올릴 때 이미 긴 변 1,600 으로 줄였지만
 * (lib/leadCardImage.ts) 넉 장이면 문서가 2MB 를 넘어 메일로 보내기 버겁다. 원본 파일은
 * 그대로 두고 **문서에 넣는 복사본만** 작게 만든다.
 */
async function shrinkForPdf(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, PDF_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', PDF_PHOTO_QUALITY)
  } catch (e) {
    console.error('[quoteDoc] 사진을 줄이지 못했다', e)
    return null
  }
}

export type DocResult = { ok: true; url: string; name: string; bytes: number } | { ok: false; error: string }

/**
 * 문서 하나를 만들어 올린다. 성공하면 **열어 볼 주소**(1시간)를 돌려준다.
 * 부르는 쪽이 새 탭으로 연다 — 팝업 차단을 피하려면 누른 직후에 탭을 열고 주소를 넣는다.
 */
export async function generateQuoteDoc(quoteId: number, kind: QuoteDocKind): Promise<DocResult> {
  const d = await fetchDocData(quoteId)
  if (!d) return { ok: false, error: `${DOC_LABEL[kind]} 자료를 불러오지 못했습니다.` }
  if (kind === 'repair' && !d.repair) return { ok: false, error: '수리 건이 연결된 견적만 수리내역서를 낼 수 있습니다.' }

  const quoteNumber = d.quote.quote_number ?? ''
  const contact = contactLine(d.contact?.name, d.contact?.position, d.contact?.phone)
    // 담당자 FK 가 없는 옛 견적은 적혀 있던 글자를 그대로 쓴다(lib/quoteRecipient.ts 와 같은 규칙).
    || (d.quote.recipient ?? '')

  // pdf() 는 <Document> 하나를 받는다 — 두 문서가 서로 다른 props 라 여기서 한 꼴로 눕힌다.
  let element: React.ReactElement
  if (kind === 'transaction') {
    element = createElement(TransactionPDFDoc, {
      quoteNumber,
      issuedDate: todayKST(),
      customerName: d.customer?.company_name ?? '',
      customerAddress: d.customer?.address ?? '',
      contact,
      lines: transactionLines(quoteNumber, d.items, d.repair, d.info?.result),
    })
  } else {
    // 사진은 차례대로 줄여 넣는다. 못 줄인 장은 건너뛴다(한 장 때문에 문서를 못 내면 안 된다).
    const shrunk: { src: string; caption: string | null }[] = []
    for (const ph of d.photos) {
      if (!ph.url) continue
      const src = await shrinkForPdf(ph.url)
      if (src) shrunk.push({ src, caption: (ph.caption ?? '').trim() || null })
    }
    const model = (d.repair?.product_type ?? '').trim()
    const firstItem = d.items.find(it => it.row_kind !== 'title')
    element = createElement(RepairReportPDFDoc, {
      quoteNumber,
      customerName: d.customer?.company_name ?? '',
      contact,
      receivedDate: (d.repair?.received_date ?? '').slice(0, 10) || '-',
      // 아직 안 나갔으면 「미출고」다(lib/quoteRepairInfo.ts 의 shippedLabel 과 같은 규칙).
      shippedDate: (d.repair?.shipped_date ?? '').slice(0, 10) || '미출고',
      itemType: (d.repair?.item_type ?? '').trim() || '-',
      serialNumber: (d.repair?.serial_number ?? '').trim() || '-',
      nameModel: [((firstItem?.product_name ?? '').trim() || (firstItem ? modelOf(firstItem) : '')), model]
        .filter(Boolean).join(' ') || '-',
      partCode: (firstItem?.part_code ?? '').trim() || '-',
      symptom: d.info?.symptom ?? '',
      cause: d.info?.cause ?? '',
      workPeriod: workPeriod(d.repair),
      result: d.info?.result ?? '',
      photos: shrunk,
      parts: partRows(d.items),
      engineer: personLabel(d.engineer?.name, d.engineer?.position),
      engineerTel: officeTel(d.engineer?.office),
    })
  }

  let dataUrl: string
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blob = await pdf(element as any).toBlob()
    dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsDataURL(blob)
    })
  } catch (e) {
    console.error('[quoteDoc] PDF 생성 실패', e)
    return { ok: false, error: `${DOC_LABEL[kind]}를 만들지 못했습니다.` }
  }

  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'doc-save', quoteId, kind, dataUrl }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.url) return { ok: false, error: json?.error ?? `${DOC_LABEL[kind]}를 저장하지 못했습니다.` }
    return { ok: true, url: json.url as string, name: json.name as string, bytes: Number(json.bytes) || 0 }
  } catch {
    return { ok: false, error: `${DOC_LABEL[kind]}를 저장하지 못했습니다.` }
  }
}

/** 화면이 쓰는 이름 — 토스트·단추 글자. */
export { DOC_LABEL, docNumber }

/**
 * **이미 만들어 둔 문서**의 주소만 받는다 — 다시 그리지 않는다(아이콘이 파란 줄).
 * 파일이 없으면 ok:false 라, 부르는 쪽이 그때 만든다.
 */
export async function existingQuoteDoc(quoteId: number, kind: QuoteDocKind): Promise<DocResult> {
  try {
    const res = await fetch('/api/quote-repair-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'doc-url', quoteId, kind }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json?.url) return { ok: false, error: '아직 만들어 둔 문서가 없습니다.' }
    return { ok: true, url: json.url as string, name: json.name as string, bytes: 0 }
  } catch {
    return { ok: false, error: '문서를 열지 못했습니다.' }
  }
}
