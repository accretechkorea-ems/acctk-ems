import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import type { Customer, Device, Contact, ServiceHistory } from './types'

type Props = {
  service: ServiceHistory
  device: Device
  customer: Customer
  contact: Contact | null
  engineerNames: string
  firstEngineerName: string
  engineerSignDataUrl?: string
  customerSignDataUrl?: string
}

const RS = StyleSheet.create({
  page: { fontSize: 9, padding: 30, backgroundColor: '#fff' },
})

// 한 글자의 대략적 폭 (CJK는 폰트크기와 같은 전각, 그 외는 절반) 기준으로
// 텍스트가 박스(innerW x innerH) 안에 다 들어가는 가장 큰 폰트 크기를 찾는다.
const CJK = /[가-힣　-〿぀-ヿ一-鿿＀-￯]/
function fitFontSize(text: string, innerW: number, innerH: number, base = 9, min = 5, lineHeight = 1.6): number {
  const content = text ?? ''
  if (!content.trim()) return base
  const explicitLines = content.split('\n')
  for (let fs = base; fs >= min; fs -= 0.25) {
    let totalLines = 0
    for (const line of explicitLines) {
      let w = 0
      for (const ch of line) w += CJK.test(ch) ? fs : fs * 0.5
      totalLines += Math.max(1, Math.ceil(w / innerW))
    }
    if (totalLines * fs * lineHeight <= innerH) return fs
  }
  return min
}

export default function ServiceReportDoc({ service, device, customer, contact, engineerNames, firstEngineerName, engineerSignDataUrl, customerSignDataUrl }: Props) {
  const deviceTitle = `${device.device_name ?? ''} ${device.device_name2 ?? ''} ${device.option ?? ''}`.replace(/\s+/g, ' ').trim()
  const fontFamily = 'NotoSansCJK'

  // 내용 칸: 고정 높이 안에 다 들어가도록 폰트 크기 자동 축소
  // (A/S 칸 height 300 / 기타사항 칸 height 78, 좌우 padding 10, 상하 padding 8)
  const asFontSize = fitFontSize(service.service_notes ?? '', 500, 284)
  const etcFontSize = fitFontSize(service.etc_notes ?? '', 500, 62)

  const infoRows = [
    { label: '엔지니어 이름', value: engineerNames, label2: '사업부', value2: '계측' },
    { label: '장비종류', value: device.device_name ?? '-', label2: '유/무상', value2: service.is_paid ? '유상' : '무상' },
    { label: '장비명', value: `${device.device_name2 ?? ''} ${device.option ?? ''}`.trim() || '-', label2: '대리점', value2: customer?.agency ?? '-' },
    { label: 'SER.NO', value: device.serial_number ?? '-', label2: 'OS Ver.', value2: device.program ?? '-' },
    { label: '작업유형', value: service.service_type ?? '-', label2: '작업시간', value2: service.work_hours ? `${service.work_hours}h` : '-' },
  ]

  return (
    <Document>
      <Page size="A4" style={RS.page}>
        <View style={{ borderWidth: 1.5, borderColor: '#000' }}>

          {/* 헤더 */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '8 12', borderBottomWidth: 1.5, borderBottomColor: '#000' }}>
            <View style={{ flex: 1 }} />
            <View style={{ flex: 2, alignItems: 'center' }}>
              <Text style={{ fontSize: 22, fontFamily, fontWeight: 'bold', letterSpacing: 3 }}>AFTER  SERVICE</Text>
              <Text style={{ fontSize: 8, color: '#555', fontFamily, marginTop: 2 }}>(http://www.accretechkorea.com)</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Image src="/quotelogo.png" style={{ width: 110, height: 26 }} />
            </View>
          </View>

          {/* 사용자 섹션 */}
          <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', minHeight: 120 }}>
            <View style={{ width: 22, borderRightWidth: 1, borderRightColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{'사\n용\n자'}</Text>
            </View>
            <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: '#000' }}>
              {/* 고객사 */}
              <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999', height: 48, alignItems: 'center' }}>
                <View style={{ width: 55, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>고객사</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{customer?.company_name ?? '-'}</Text>
                </View>
              </View>
              {/* 날짜 */}
              <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999', height: 24, alignItems: 'center' }}>
                <View style={{ width: 55, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>날짜</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>{service.visit_date ?? '-'}</Text>
                </View>
              </View>
              {/* 담당자 */}
              <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999', height: 24, alignItems: 'center' }}>
                <View style={{ width: 55, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>담당자</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>{contact ? `${contact.name ?? ''} ${contact.position ?? ''}`.trim() : '-'}</Text>
                </View>
              </View>
              {/* 방문부서 */}
              <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#999', height: 24, alignItems: 'center' }}>
                <View style={{ width: 55, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>방문부서</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>{contact?.department ?? '-'}</Text>
                </View>
              </View>
              {/* 연락처 */}
              <View style={{ flexDirection: 'row', height: 24, alignItems: 'center' }}>
                <View style={{ width: 55, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>연락처</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily }}>{contact?.phone ?? '-'}</Text>
                </View>
              </View>
            </View>

            {/* 서명 섹션 */}
            <View style={{ width: 180 }}>
              <View style={{ height: 72, borderBottomWidth: 0.5, borderBottomColor: '#999', flexDirection: 'row' }}>
                <View style={{ width: 28, borderRightWidth: 0.5, borderRightColor: '#999', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 8, fontFamily, textAlign: 'center' }}>{'고\n객'}</Text>
                </View>
                <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: '#999', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{contact?.name ?? ''}</Text>
                </View>
                <View style={{ width: 36, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 8, fontFamily, textAlign: 'center' }}>{'서\n명'}</Text>
                  {customerSignDataUrl && <Image src={customerSignDataUrl} style={{ position: 'absolute', width: 34, height: 68, objectFit: 'contain' }} />}
                </View>
              </View>
              <View style={{ height: 72, flexDirection: 'row' }}>
                <View style={{ width: 28, borderRightWidth: 0.5, borderRightColor: '#999', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 8, fontFamily, textAlign: 'center' }}>{'담\n당'}</Text>
                </View>
                <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: '#999', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{firstEngineerName}</Text>
                </View>
                <View style={{ width: 36, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 8, fontFamily, textAlign: 'center' }}>{'서\n명'}</Text>
                  {engineerSignDataUrl && <Image src={engineerSignDataUrl} style={{ position: 'absolute', width: 34, height: 68, objectFit: 'contain' }} />}
                </View>
              </View>
            </View>
          </View>

          {/* 엔지니어/장비 정보 행 */}
          {infoRows.map(({ label, value, label2, value2 }, i, arr) => (
            <View key={i} style={{ flexDirection: 'row', borderBottomWidth: i < arr.length - 1 ? 0.5 : 1, borderBottomColor: i < arr.length - 1 ? '#999' : '#000', height: 22, alignItems: 'center' }}>
              <View style={{ flex: 1, flexDirection: 'row', borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', alignItems: 'center' }}>
                <View style={{ width: 70, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', paddingLeft: 4 }}>
                  <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{label}</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{value}</Text>
                </View>
              </View>
              <View style={{ flex: 1, flexDirection: 'row', height: '100%', alignItems: 'center' }}>
                <View style={{ width: 70, borderRightWidth: 0.5, borderRightColor: '#999', height: '100%', justifyContent: 'center', paddingLeft: 4 }}>
                  <Text style={{ fontSize: 9, fontFamily, fontWeight: 'bold', textAlign: 'center' }}>{label2}</Text>
                </View>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, fontFamily, textAlign: 'center' }}>{value2}</Text>
                </View>
              </View>
            </View>
          ))}

          {/* A/S 내용 — 고정 높이 + 넘치면 잘림(한 페이지 유지) */}
          <View style={{ borderBottomWidth: 1, borderBottomColor: '#000' }}>
            <View style={{ borderBottomWidth: 1, borderBottomColor: '#555', padding: '4 0', alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily }}>A/S 및 납입 내용</Text>
            </View>
            <View style={{ height: 300, padding: '8 10', overflow: 'hidden' }}>
              <Text style={{ fontSize: asFontSize, fontFamily, lineHeight: 1.6 }}>{service.service_notes ?? ''}</Text>
            </View>
          </View>

          {/* 기타사항 — 고정 높이 + 넘치면 잘림 */}
          <View>
            <View style={{ borderBottomWidth: 1, borderBottomColor: '#555', padding: '4 0', alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily }}>기타사항</Text>
            </View>
            <View style={{ height: 78, padding: '8 10', overflow: 'hidden' }}>
              <Text style={{ fontSize: etcFontSize, fontFamily, lineHeight: 1.6 }}>{service.etc_notes ?? ''}</Text>
            </View>
          </View>
        </View>

        <Text style={{ textAlign: 'center', fontSize: 10, marginTop: 8, fontFamily, fontWeight: 'bold' }}>ACCRETECHKOREA Co., Ltd.</Text>
      </Page>
    </Document>
  )
}
