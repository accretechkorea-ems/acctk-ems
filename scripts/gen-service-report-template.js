// 서비스 레포트(AFTER SERVICE) PDF 양식과 동일한 레이아웃의 "빈" 엑셀 템플릿 생성
// 실행: node scripts/gen-service-report-template.js
// 출력: public/서비스레포트_양식.xlsx
const ExcelJS = require('exceljs')
const path = require('path')

const FONT = '맑은 고딕'

async function main() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('서비스레포트', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  })

  // 컬럼 폭 (A~H)
  const widths = [5, 16, 13, 13, 13, 11, 14, 9]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  const center = { vertical: 'middle', horizontal: 'center', wrapText: true }
  const setCell = (ref, value, opts = {}) => {
    const cell = ws.getCell(ref)
    if (value !== undefined) cell.value = value
    cell.alignment = opts.alignment || center
    cell.font = { name: FONT, size: opts.size || 10, bold: !!opts.bold, color: opts.color }
    if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
    return cell
  }

  // ── 1행: 헤더 (타이틀 + 로고) ──
  ws.getRow(1).height = 50
  ws.mergeCells('B1:F1')
  const title = ws.getCell('B1')
  title.value = {
    richText: [
      { font: { name: FONT, size: 20, bold: true }, text: 'AFTER  SERVICE\n' },
      { font: { name: FONT, size: 8, color: { argb: 'FF555555' } }, text: '(http://www.accretechkorea.com)' },
    ],
  }
  title.alignment = center
  // 로고
  try {
    const imgId = wb.addImage({ filename: path.join(__dirname, '..', 'public', 'quotelogo.png'), extension: 'png' })
    ws.addImage(imgId, { tl: { col: 6.15, row: 0.28 }, ext: { width: 120, height: 28 } })
  } catch {
    setCell('G1', 'ACCRETECH', { size: 9, bold: true })
  }

  // ── 사용자 섹션 (2~6행) ──
  ws.mergeCells('A2:A6')
  setCell('A2', '사\n용\n자', { size: 10 })

  const userFields = ['고객사', '날짜', '담당자', '방문부서', '연락처']
  userFields.forEach((label, i) => {
    const r = 2 + i
    ws.getRow(r).height = i === 0 ? 34 : 22
    setCell(`B${r}`, label, { size: 9 })
    ws.mergeCells(`C${r}:E${r}`)
    setCell(`C${r}`, '', { size: 9 })
  })

  // 서명 영역 (고객 / 담당)
  ws.mergeCells('F2:F4'); setCell('F2', '고\n객', { size: 9 })
  ws.mergeCells('G2:G4'); setCell('G2', '', { size: 9 })
  ws.mergeCells('H2:H4'); setCell('H2', '서\n명', { size: 9 })
  ws.mergeCells('F5:F6'); setCell('F5', '담\n당', { size: 9 })
  ws.mergeCells('G5:G6'); setCell('G5', '', { size: 9 })
  ws.mergeCells('H5:H6'); setCell('H5', '서\n명', { size: 9 })

  // ── 엔지니어/장비 정보 (7~11행) ──
  const infoRows = [
    ['엔지니어 이름', '', '사업부', '계측'],
    ['장비종류', '', '유/무상', ''],
    ['장비명', '', '대리점', ''],
    ['SER.NO', '', 'OS Ver.', ''],
    ['작업유형', '', '작업시간', ''],
  ]
  infoRows.forEach((row, i) => {
    const r = 7 + i
    ws.getRow(r).height = 22
    ws.mergeCells(`A${r}:B${r}`); setCell(`A${r}`, row[0], { size: 9 })
    ws.mergeCells(`C${r}:D${r}`); setCell(`C${r}`, row[1], { size: 9 })
    ws.mergeCells(`E${r}:F${r}`); setCell(`E${r}`, row[2], { size: 9, bold: true })
    ws.mergeCells(`G${r}:H${r}`); setCell(`G${r}`, row[3], { size: 9 })
  })

  // ── A/S 및 납입 내용 (12 헤더, 13 본문) ──
  ws.getRow(12).height = 18
  ws.mergeCells('A12:H12'); setCell('A12', 'A/S 및 납입 내용', { size: 9, fill: 'FFF3F4F6' })
  ws.getRow(13).height = 300
  ws.mergeCells('A13:H13')
  setCell('A13', '', { alignment: { vertical: 'top', horizontal: 'left', wrapText: true }, size: 9 })

  // ── 기타사항 (14 헤더, 15 본문) ──
  ws.getRow(14).height = 18
  ws.mergeCells('A14:H14'); setCell('A14', '기타사항', { size: 9, fill: 'FFF3F4F6' })
  ws.getRow(15).height = 70
  ws.mergeCells('A15:H15')
  setCell('A15', '', { alignment: { vertical: 'top', horizontal: 'left', wrapText: true }, size: 9 })

  // ── 테두리: A1:H15 전체 그리드 + 외곽 굵게 ──
  const edgeBottoms = new Set([1, 6, 11, 13, 15])
  for (let r = 1; r <= 15; r++) {
    for (let c = 1; c <= 8; c++) {
      const cell = ws.getRow(r).getCell(c)
      cell.border = {
        top: { style: r === 1 ? 'medium' : 'thin', color: { argb: 'FF000000' } },
        bottom: { style: edgeBottoms.has(r) ? 'medium' : 'thin', color: { argb: 'FF000000' } },
        left: { style: c === 1 ? 'medium' : 'thin', color: { argb: 'FF000000' } },
        right: { style: c === 8 ? 'medium' : 'thin', color: { argb: 'FF000000' } },
      }
    }
  }

  // ── 푸터 (16행, 테두리 없음) ──
  ws.getRow(16).height = 20
  ws.mergeCells('A16:H16')
  setCell('A16', 'ACCRETECHKOREA Co., Ltd.', { size: 10, bold: true })

  const outPath = path.join(__dirname, '..', 'public', '서비스레포트_양식.xlsx')
  await wb.xlsx.writeFile(outPath)
  console.log('생성 완료:', outPath)
}

main().catch((e) => { console.error(e); process.exit(1) })
