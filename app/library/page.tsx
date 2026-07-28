'use client'

const PAGE_BG = '#f4f5f7'
const CARD_BG = '#ffffff'
const BORDER = '#e5e7eb'
const TEXT = '#111113'
const GRAY = '#6b7280'

export default function DocumentsPage() {
  return (
    <div style={{ background: PAGE_BG, minHeight: '100vh', padding: '24px 28px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* 헤더 */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: TEXT, margin: 0 }}>📂 자료실</h1>
        </div>

        {/* 추후 업데이트 안내 */}
        <div
          style={{
            background: CARD_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 16,
            padding: '80px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 20 }}>🛠️</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: TEXT, marginBottom: 10 }}>
            추후 업데이트 예정
          </div>
          <div style={{ fontSize: 14, color: GRAY, lineHeight: 1.7, maxWidth: 420 }}>
            자료실은 새로운 방식으로 준비 중입니다.<br />
            준비가 완료되면 다시 안내드리겠습니다.
          </div>
        </div>
      </div>
    </div>
  )
}
