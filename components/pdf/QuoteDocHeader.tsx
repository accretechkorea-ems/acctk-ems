// 두 문서의 **머리** — 로고 · 회사 세 줄 · 제목 · 밑줄 · 견적번호 줄.
//
// mono.css 의 .top / h1 / .under / .doc 를 그대로 옮긴 것이다.

import { Image, Text, View } from '@react-pdf/renderer'
import {
  C_BLACK, CONTENT_W, CORP_LINES, LOGO_H, LOGO_SRC, LOGO_W, MM,
  S_CORP, S_DOC, S_TITLE, W_RULE,
} from './docBase'

export type QuoteDocHeaderProps = {
  title: string
  /** 왼쪽 — 「견적번호 : …」. */
  left: string
  /** 오른쪽 — 거래명세서는 「거래일 : …」, 수리내역서는 비운다. */
  right?: string
}

export default function QuoteDocHeader({ title, left, right }: QuoteDocHeaderProps) {
  return (
    <View>
      {/* .top{display:flex;justify-content:space-between;align-items:flex-start} */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {/* react-pdf 의 Image 는 HTML img 가 아니라 alt 를 받지 않는다 — 규칙이 오인한다. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image src={LOGO_SRC} style={{ width: LOGO_W, height: LOGO_H }} />
        {/* .corp{font-size:8.5pt;text-align:right;line-height:1.4} */}
        <View>
          {CORP_LINES.map(line => (
            <Text key={line} style={{ fontSize: S_CORP, textAlign: 'right', lineHeight: 1.4 }}>{line}</Text>
          ))}
        </View>
      </View>

      {/* h1{font-size:24pt;letter-spacing:14px;text-align:center}
          글자 사이를 벌리면 마지막 글자 뒤의 빈자리만큼 왼쪽으로 치우친다 — 견적서 제목과
          같은 방법으로 왼쪽 여백을 그만큼 준다(text-indent:14px 가 그 뜻이다). */}
      <Text style={{
        fontSize: S_TITLE, textAlign: 'center', letterSpacing: 14,
        paddingLeft: 14, marginTop: 8, marginBottom: 2,
      }}>{title}</Text>
      {/* .under{border-bottom:2px solid #000;margin:2px 0 10px} */}
      <View style={{ borderBottomWidth: W_RULE, borderBottomColor: C_BLACK, width: CONTENT_W, marginBottom: 2.5 * MM }} />

      {/* .doc{display:flex;justify-content:space-between;font-size:9.5pt;margin-bottom:6px} */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1.6 * MM }}>
        <Text style={{ fontSize: S_DOC }}>{left}</Text>
        <Text style={{ fontSize: S_DOC }}>{right ?? ''}</Text>
      </View>
    </View>
  )
}
