'use client'

// 고객사 주소 입력 — 카카오 우편번호 검색 + 상세 주소.
//
// 왜 필요한가: 주소가 자유 입력이라 오타가 나고, 그 주소로 좌표 변환(지오코딩)이 실패하면
// 업체 등록 자체가 막혔다. 정규 주소를 쓰면 그 실패가 대부분 사라진다.
//
// 저장 모양은 지금과 같다 — DB 컬럼은 customers.address 하나뿐이고, 이 컴포넌트가
// 「도로명 + 상세」를 합쳐 한 문자열로 올려준다. 그래서 저장 코드(lib/addCustomer.ts ·
// hooks/customer/useCustomerCrud.ts)는 고치지 않았다.
//
// 주소 칸은 검색 전용이다 — 항상 읽기 전용이고, 값은 검색 결과로만 채워진다(네이버·카카오
// 가입 폼과 같은 방식). 자유 입력을 열어 두면 검색을 건너뛰고 아무 값이나 넣게 되어
// 오타 방지라는 목적 자체가 무너졌다. 칸을 클릭해도 검색이 열린다(버튼만 찾지 않아도 되게).
//
// 두 가지 모양으로 동작한다.
//   · 검색 전 — 주소 한 칸(읽기 전용). 기존 업체를 수정할 때는 저장된 예전 주소가 여기 그대로
//     보이고, 새로 검색하기 전까지 그 값이 유지된다(예전 주소를 도로명·상세로 쪼개려 들면
//     틀리게 쪼개진다 — 그래서 쪼개지 않는다).
//   · 검색 후 — 도로명 칸(읽기 전용) + 상세 주소 칸(선택 입력). 검색으로 주소를 고른
//     그 순간부터 이 모양이 된다.
//
// 상세 주소 칸을 「검색으로 고른 뒤」에만 여는 이유: 쪼개지 않은 옛 값에는 도로명과 상세의
// 경계가 없어 무엇에 이어 붙일지 알 수 없고, 그 값에 이미 동·호수가 들어 있으면 두 번 들어간다.
// 기존 업체의 상세만 고치려면 주소를 다시 검색하면 된다(한 번에 둘 다 정해진다).
//
// 검색 화면은 새 창이 아니라 화면 가운데 오버레이로 띄운다(embed).
//   · 새 창(window.open)은 브라우저 팝업 차단에 걸리고 휴대폰에서 다루기 어렵다.
//   · 주소 칸 아래에 끼우는 방식도 버렸다 — 모달이 maxHeight 안에서 스크롤되는 구조라
//     500px 검색 화면이 위아래로 잘리고 그 안에서 스크롤도 되지 않았다.
// 오버레이는 포털로 body 에 붙인다(components/common/Popover.tsx 와 같은 방식). 모달 안에 두면
// 모달의 스택 컨텍스트·overflow 에 갇혀 z-index 값이 제 뜻대로 먹지 않기 때문이다.
// 어느 방식이든 카카오 화면은 iframe 으로 들어오므로 CSP 의 frame-src 에
// postcode.map.kakao.com 이 있어야 한다(next.config.ts).
//
// 우편번호(zonecode)도 함께 받아오지만 저장할 칸이 없어 쓰지 않는다.
//
// 스크립트는 이 컴포넌트를 처음 쓸 때만 내려받는다(전역에 미리 넣지 않는다).

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import ModalOverlay from '@/components/common/ModalOverlay'
import { Z } from '@/lib/zIndex'

/** 카카오 우편번호 서비스. 키 발급·신청이 필요 없고 무료다. */
const POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
const SCRIPT_ID = 'daum-postcode-script'

type PostcodeResult = {
  /** 도로명 주소(도로명이 없는 지역이면 빈 문자열) */
  roadAddress?: string
  /** 지번 주소 */
  jibunAddress?: string
  /** 참고항목 — 건물명·동 이름 등 */
  buildingName?: string
  /** 우편번호 5자리. 저장할 칸이 없어 쓰지 않는다. */
  zonecode?: string
}

type PostcodeOptions = {
  oncomplete: (r: PostcodeResult) => void
  /** 검색 화면이 닫힐 때. autoClose 로 스스로 닫힌 경우도 부른다. */
  onclose?: () => void
  width?: string | number
  height?: string | number
}

/** embed 만 쓴다 — open(새 창)은 쓰지 않는다. */
type DaumPostcode = new (opts: PostcodeOptions) => {
  embed: (el: HTMLElement, opts?: { autoClose?: boolean }) => void
}

declare global {
  interface Window {
    daum?: { Postcode?: DaumPostcode }
  }
}

/** 내려받기 중인 약속을 공유한다 — 두 모달이 동시에 열려도 스크립트는 한 번만 받는다. */
let postcodePromise: Promise<DaumPostcode> | null = null

function loadPostcode(): Promise<DaumPostcode> {
  if (typeof window === 'undefined') return Promise.reject(new Error('window is undefined'))
  if (window.daum?.Postcode) return Promise.resolve(window.daum.Postcode)
  if (postcodePromise) return postcodePromise

  postcodePromise = new Promise<DaumPostcode>((resolve, reject) => {
    const done = () => {
      if (window.daum?.Postcode) resolve(window.daum.Postcode)
      else reject(new Error('우편번호 서비스를 불러오지 못했습니다'))
    }
    const fail = () => {
      // 실패한 약속을 남겨 두면 다시 눌러도 계속 실패한다 — 비워서 다음 시도를 열어 준다.
      postcodePromise = null
      reject(new Error('우편번호 서비스를 불러오지 못했습니다'))
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      if (window.daum?.Postcode) { done(); return }
      existing.addEventListener('load', done)
      existing.addEventListener('error', fail)
      return
    }

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = POSTCODE_SRC
    script.async = true
    script.addEventListener('load', done)
    script.addEventListener('error', fail)
    document.head.appendChild(script)
  })
  return postcodePromise
}

/** 검색 결과 → 주소 한 줄. 도로명이 없는 지역은 지번 주소를 쓴다. */
function pickAddress(r: PostcodeResult): string {
  const base = (r.roadAddress || r.jibunAddress || '').trim()
  const building = (r.buildingName || '').trim()
  // 건물명은 지오코딩에 도움이 되고 사람이 알아보기도 쉬워 괄호로 붙인다(카카오 기본 표기와 같다).
  return building ? `${base} (${building})` : base
}

const labelStyle: CSSProperties = { fontSize: 12, color: '#9ca3af', marginBottom: 4, display: 'block' }

export default function AddressField({
  value, onChange, onTouch, error, inputStyle, errorBorder, disabled,
}: {
  /** 지금까지의 주소(합쳐진 한 문자열). 저장되는 값 그대로다. */
  value: string
  onChange: (next: string) => void
  /** 입력이 생기면 부른다(오류 표시 지우기 용). */
  onTouch?: () => void
  error?: string
  /** 모달마다 입력칸 모양이 달라 바깥에서 받는다. */
  inputStyle: CSSProperties
  errorBorder: string
  disabled?: boolean
}) {
  // road 가 null 이면 「검색 전」 — 한 칸 자유 입력. 검색으로 고른 뒤에는 두 칸으로 갈린다.
  const [road, setRoad] = useState<string | null>(null)
  const [detail, setDetail] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 검색 오버레이가 떠 있는지. 뜸·닫힘이 곧 검색 화면의 생성·제거다.
  const [boxOpen, setBoxOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const style = error ? { ...inputStyle, border: errorBorder } : inputStyle

  /** 도로명·상세를 합쳐 한 문자열로 올린다. 상세가 비면 도로명만. */
  const push = (nextRoad: string, nextDetail: string) => {
    const joined = nextDetail.trim() ? `${nextRoad} ${nextDetail.trim()}` : nextRoad
    onChange(joined)
    onTouch?.()
  }

  /** 스크립트만 확보하고 오버레이를 띄운다. 검색 화면을 끼워 넣는 일은 아래 효과가 한다. */
  const search = async () => {
    setLoadError(null)
    setLoading(true)
    try {
      await loadPostcode()
      setBoxOpen(true)
    } catch (e) {
      console.error('[address] postcode load failed', e)
      setLoadError('우편번호 서비스를 불러오지 못했습니다. 잠시 뒤 다시 시도하거나 주소를 직접 입력해주세요.')
    } finally {
      setLoading(false)
    }
  }

  // 오버레이 안에 검색 화면을 끼워 넣는다.
  // 먼저 컨테이너를 비우는 이유: 라이브러리는 부를 때마다 레이어를 새로 만들어 붙이므로,
  // 같은 요소에 두 번 끼우면 두 겹이 쌓인다.
  useEffect(() => {
    const el = boxRef.current
    const Postcode = window.daum?.Postcode
    if (!boxOpen || !el || !Postcode) return

    el.innerHTML = ''
    new Postcode({
      oncomplete: r => {
        const picked = pickAddress(r)
        if (picked) {
          setRoad(picked)
          setDetail('')
          push(picked, '')
        }
        setBoxOpen(false)
      },
      // autoClose 로 스스로 닫힌 경우에도 박스를 접어 상태를 맞춘다.
      onclose: () => setBoxOpen(false),
      width: '100%',
      height: '100%',
    }).embed(el, { autoClose: true })

    return () => { el.innerHTML = '' }
    // push 는 매 렌더 새로 만들어진다. 띄울 때 한 번만 끼우면 되므로 boxOpen 만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxOpen])

  // 떠 있는 동안 ESC 로 닫고 뒤쪽 스크롤을 잠근다(Sidebar 드로어와 같은 방식).
  // 카카오 화면 안(iframe)에 포커스가 있으면 키 이벤트가 우리 쪽으로 오지 않는다 —
  // 그래서 [닫기] 버튼과 바깥 클릭이 항상 함께 있어야 한다.
  useEffect(() => {
    if (!boxOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBoxOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [boxOpen])

  // 오버레이가 떠 있는 동안은 다시 누를 일이 없다 — 오버레이의 [닫기]로 닫는다.
  const btnOff = loading || boxOpen || disabled

  const searchBtn = (
    <button
      type="button"
      onClick={search}
      disabled={btnOff}
      style={{
        flexShrink: 0, padding: '0 14px', height: 'auto', alignSelf: 'stretch',
        background: '#f3f4f6', color: btnOff ? '#9ca3af' : '#6b7280',
        border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
        cursor: btnOff ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
      }}
    >
      {loading ? '불러오는 중...' : '주소 검색'}
    </button>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        {/*
          읽기 전용 — 타이핑으로는 아무 값도 넣을 수 없다. 값은 oncomplete 만 채운다.
          readOnly 인 칸에는 onChange 가 필요 없다(React 도 경고하지 않는다).
          클릭·Enter 로도 검색이 열린다 — 읽기 전용 칸을 눌렀을 때 아무 일도 없으면
          고장으로 보인다.
        */}
        <input
          value={road ?? value}
          readOnly
          disabled={disabled}
          onClick={btnOff ? undefined : search}
          onKeyDown={btnOff ? undefined : e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); search() } }}
          placeholder="주소 검색을 눌러 입력"
          title="주소 검색으로만 입력할 수 있습니다"
          style={{ ...style, background: '#fafafa', cursor: btnOff ? 'not-allowed' : 'pointer' }}
        />
        {searchBtn}
      </div>

      {/*
        검색 오버레이 — embed 는 제목줄도 닫기 버튼도 없어 우리가 붙인다.
        Z.subModal = 「모달 위에서 다시 열리는 모달」 층위(lib/zIndex.ts)로, 세 화면 중
        두 곳이 모달 안이라 이 층이 정확히 맞는다. 새 값을 만들지 않았다.
        서버 렌더에는 body 가 없다 — boxOpen 은 사용자가 눌러야 켜지므로 그릴 것도 없다.
      */}
      {boxOpen && typeof document !== 'undefined' && createPortal(
        <ModalOverlay onClose={() => setBoxOpen(false)} style={{ zIndex: Z.subModal }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 500, maxWidth: '90vw', height: 500, maxHeight: '80vh',
              display: 'flex', flexDirection: 'column',
              background: '#ffffff', borderRadius: 8, border: '1px solid #ebebeb',
              boxShadow: '0 20px 60px rgba(0,0,0,0.22)', overflow: 'hidden',
            }}
          >
            <div style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 16px', borderBottom: '1px solid #ebebeb',
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', letterSpacing: '-0.2px' }}>주소 검색</div>
              <button
                type="button"
                onClick={() => setBoxOpen(false)}
                style={{
                  padding: '4px 10px', background: '#f3f4f6', color: '#6b7280',
                  border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                닫기
              </button>
            </div>
            {/* 남은 높이를 검색 화면이 채운다. minHeight 0 이 없으면 flex 항목이 줄지 않아 넘친다. */}
            <div ref={boxRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
          </div>
        </ModalOverlay>,
        document.body,
      )}

      {/* 상세 주소 — 검색으로 도로명을 고른 뒤에만 나온다(동·호수 등). */}
      {road !== null && (
        <div style={{ marginTop: 6 }}>
          <label style={labelStyle}>상세 주소 (선택)</label>
          <input
            value={detail}
            onChange={e => { setDetail(e.target.value); push(road, e.target.value) }}
            disabled={disabled}
            placeholder="동·호수 등 (선택)"
            style={inputStyle}
          />
        </div>
      )}

      {loadError && (
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: '#dc2626' }}>{loadError}</div>
      )}
    </div>
  )
}
