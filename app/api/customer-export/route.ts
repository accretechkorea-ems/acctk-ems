// 고객사 **전부 내보내기** — 네 시트(사업장·회사·대리점·장비) 엑셀 (2026-11-22).
//
// ── 왜 서버인가 ────────────────────────────────────────────────────────────
//   전에는 브라우저에서 xlsx 로 만들었다(시트 하나·열 13개). 이번 양식은
//     · 표 일곱 개를 모아 읽어야 하고(사업장·회사·대리점·장비·담당자·견적·서비스),
//     · 머리줄 **고정**이 필요하다 — 쓰던 xlsx 0.18.5 는 틀 고정을 쓰지 못한다
//       (lib/customerExcel.ts 의 머리말에 그 사정이 적혀 있다. exceljs 는 쓴다),
//     · 2,000줄이 넘어도 멈추면 안 된다 — 브라우저 본 스레드에서 만들면 그동안 화면이 선다.
//   그래서 접촉 보고서 엑셀(/api/semi-contact/export)과 **같은 방식**으로 옮겼다.
//
// ── 일을 셋으로 나눠 둔다 ──────────────────────────────────────────────────
//   lib/customerExportData.ts    어떤 줄을 담을지(조회·셈). 실측 도구와 같이 쓴다.
//   lib/customerExportSheets.ts  어떤 열을 어떤 순서로 쓸지(순수). 하네스가 지킨다.
//   이 파일                      권한 · 엑셀 서식(굵은 머리줄·고정·열 폭·날짜) · 내려보내기.
//
// 쓰기는 없다 — 읽기만 한다.

import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'
import { gatherCustomerExport } from '@/lib/customerExportData'
import { buildCustomerSheets, customerExportFileName, sheetWidths } from '@/lib/customerExportSheets'

const TAG = 'customer-export'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const bad = (message: string, status: number) => NextResponse.json({ error: message }, { status })

/** 한글 파일명이 깨지지 않게 filename*(UTF-8)을 주고, 옛 브라우저용 ASCII 이름도 함께 둔다. */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export async function POST(req: Request) {
  // 화면의 엑셀 단추와 같은 문턱이다 — app/page.tsx 의 canExportExcel = isSuperAdmin.
  const { error: authErr, caller, sb } = await loadCaller({ kind: 'superadmin' }, { tag: TAG, req })
  if (authErr) return authErr

  let siteIds: number[]
  try {
    const body = await req.json()
    const raw = Array.isArray(body?.siteIds) ? body.siteIds : null
    if (!raw) return bad('사업장 목록이 없습니다.', 400)
    siteIds = raw.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
  } catch {
    return bad('요청을 읽지 못했습니다.', 400)
  }
  if (siteIds.length === 0) return bad('내보낼 사업장이 없습니다.', 400)

  const got = await gatherCustomerExport(sb, siteIds)
  if ('error' in got) {
    console.error(`[${TAG}] 조회 실패`, got.error)
    return bad('목록을 읽지 못했습니다.', 500)
  }
  const { sites, companies, agencies, devices } = got.data

  const sheets = buildCustomerSheets(got.data)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'EMS'
  wb.created = new Date()
  for (const sheet of sheets) {
    // 머리줄 고정 — 아래로 굴러도 열 이름이 남는다(xlsx 로는 못 하던 것이다).
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    for (const row of sheet.rows) ws.addRow(row)
    const widths = sheetWidths(sheet.rows)
    ws.columns.forEach((col, i) => { col.width = widths[i] ?? 10 })
    const head = ws.getRow(1)
    head.font = { bold: true }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
    // 날짜 칸은 날짜 서식으로 — 거르기·정렬이 날짜로 된다.
    ws.eachRow((row, n) => {
      if (n === 1) return
      row.eachCell(cell => { if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd' })
    })
    // 머리글에서 바로 거를 수 있게 자동 필터를 건다.
    if (sheet.rows.length > 1 && sheet.rows[0].length > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.rows[0].length } }
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const fileName = customerExportFileName()
  console.log(`[${TAG}] 내려받기`, {
    by: caller.engineer_id,
    사업장: sites.length, 회사: companies.length, 대리점: agencies.length, 장비: devices.length,
  })
  return new NextResponse(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': disposition(fileName),
      'Cache-Control': 'no-store',
      // 화면이 토스트에 쓴다 — 본문은 파일이라 숫자를 머리에 싣는다.
      'X-Export-Counts': JSON.stringify({
        sites: sites.length, companies: companies.length, agencies: agencies.length, devices: devices.length,
      }),
    },
  })
}
