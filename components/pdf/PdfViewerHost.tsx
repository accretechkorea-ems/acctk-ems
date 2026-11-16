'use client'

// PDF 모달 뷰어를 **앱에 한 번 꽂아 두는 자리**.
//
// 화면 컴포넌트 밖(모듈 함수)에서도 PDF 를 열므로, 토스트처럼 뿌리에 하나 두고
// lib/pdfViewer.ts 의 창구로 부른다. 여기 꽂혀 있지 않으면 그 창구는 새 탭으로 떨어진다.

import { useEffect, useState } from 'react'
import PdfViewerModal from '@/components/pdf/PdfViewerModal'
import { setPdfViewerHandler, type PdfDoc } from '@/lib/pdfViewer'

export default function PdfViewerHost() {
  const [doc, setDoc] = useState<PdfDoc | null>(null)

  useEffect(() => {
    setPdfViewerHandler(d => setDoc(d))
    return () => setPdfViewerHandler(null)
  }, [])

  return doc ? <PdfViewerModal doc={doc} onClose={() => setDoc(null)} /> : null
}
