'use client'

import { useRef, useState } from 'react'
import { EditIconButton } from '@/components/common/IconButton'
import type { Device, Holding, ServiceHistory } from './types'
import { getInstallDisplay, getDefaultImageUrl } from './utils'
import { deviceImageWidthFor } from '@/lib/deviceImage'
import { isDisposed, disposedLabel, inUseOnly, disposedOnly, isPendingDelivery, isDeliveryLate, pendingLabel } from '@/lib/deviceStatus'
import { todayKST } from '@/lib/date'
import { useDeviceImageUrls, type StorageImageLookup } from '@/hooks/useStorageImageUrls'
import { R } from '@/lib/radius'
import { SUB } from '@/components/common/ui'
import TaskAddButton from '@/components/task/TaskAddButton'

/** 카드 사진을 받을 폭(px) — 장비 카드 폭에 맞춘다. */
const CARD_IMG_W = 240

/**
 * 장비 카드의 **고정 폭**과 사진 높이(4:3).
 *
 * 왜 고정인가: 폭을 남는 자리에 맞춰 늘리면 한 줄에 몇 장이 서느냐에 따라 카드가
 * 매번 달라져, 같은 장비가 화면마다 다른 크기로 보였다. 폭을 못 박고 왼쪽부터
 * 채우면 어느 화면에서나 카드는 같고 줄 수만 바뀐다.
 */
// 2026-11-26: 340 → 320. 좌 열(340)은 그대로고 카드만 좁힌다 — 1440 에서 한 줄에
// 한 장 더 서고, 사진은 4:3 그대로다(PHOTO_H 가 폭에서 나온다).
const CARD_W = 320
const PHOTO_H = Math.round((CARD_W * 3) / 4)   // 240

/** 패킹리스트 클립. 이모지는 UI 아이콘으로 쓰지 않는다(.claude/rules/design-system.md). */
function PaperclipGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}
import { elapsedLabel } from './holding'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'
import { ServiceFilesButton, reportDownloadName } from './ServiceAttachments'


type Props = {
  /** **폐기까지 포함한** 그 업체의 장비 전부. 무엇을 보일지는 아래 토글이 고른다. */
  devices: Device[]
  /** 레포트 표시 이름에 쓴다. 내려받을 때의 이름과 같아야 한다. */
  companyName: string | null
  historyByDevice: Map<number, ServiceHistory[]>
  onAddDevice: () => void
  onEditDevice: (device: Device) => void
  onAddService: (deviceId: number) => void
  onEditService: (service: ServiceHistory) => void
  /**
   * 사진을 **크게 본다**(2026-11-25). 전에는 같은 자리가 사진 등록 창을 열었다 —
   * 보려고 누른 사람이 올리는 창을 만났다. 올리고 바꾸는 일은 장비 수정 창에만 있다.
   */
  onViewPhoto: (device: Device, path: string, preview: string) => void
  onPrintReport: (service: ServiceHistory, device: Device) => void
  onOpenReport: (service: ServiceHistory) => void
  // 레포트를 만들거나 여는 중인 service_id. 그 카드의 버튼만 잠근다.
  reportBusyId: number | null
  onUploadPacking: (device: Device, file: File) => void
  onOpenPacking: (device: Device) => void
  // 홀딩 — 장비별 진행 중 1건, 레포트별 연결 건
  activeHoldingByDevice: Map<number, Holding>
  holdingByService: Map<number, Holding>
  onAddHolding: (deviceId: number, serviceId?: number | null) => void
  onOpenHolding: (h: Holding) => void
  /** 폐기 장비도 보여 줄까 — 값은 사업장 수정 모달의 체크가 들고 있다. */
  showDisposed?: boolean
}

function ServiceCard({ h, companyName, onEdit, onPrint, onOpenReport, reportBusy, holding, onAddHolding, onOpenHolding }: { h: ServiceHistory; companyName: string | null; onEdit: () => void; onPrint: () => void; onOpenReport: () => void; reportBusy: boolean; holding: Holding | undefined; onAddHolding: () => void; onOpenHolding: () => void }) {
  const [hovered, setHovered] = useState(false)
  const sc = getCategoryColor(SERVICE_TYPE_COLORS, h.service_type)

  return (
    /* 호버 테두리는 연파랑(#c7d7f8)이었다 — 2026-11-26(묶음2 D)에 공용 링으로 올렸다.
       hovered 는 그대로 쓴다: 오른쪽 「수정」 단추를 띄우고 감추는 데도 쓰이기 때문이다. */
    <div
      className="ems-pick"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', background: '#fff', borderRadius: R.control, padding: '12px 14px 12px 17px',
        border: '1px solid #ebebeb',
        boxSizing: 'border-box', transition: 'border-color 0.15s ease',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* 좌측 서비스 유형 색상 띠 */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: sc.dot ?? sc.text, borderRadius: '8px 0 0 8px' }} />

      {/* 윗줄: 타입 · 유무상 (좌) / 수정 (우) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>
            {h.service_type ?? '-'}
          </span>
          {h.is_paid !== null && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              <span style={{ color: '#6b7280' }}> · </span>{h.is_paid ? '유상' : '무상'}
            </span>
          )}
          {/* 홀딩이 걸린 레포트는 배지를, 없으면 호버 시 등록 진입점을 보여준다 */}
          {holding ? (
            <button onClick={onOpenHolding} title={holding.title}
              style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {holding.resolved_at ? '홀딩 해제됨' : '홀딩 중'}
            </button>
          ) : (
            <button onClick={onAddHolding} title="이 건으로 홀딩"
              style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: 'none', border: '1px solid #ebebeb', borderRadius: R.pill, padding: '1px 8px', cursor: 'pointer', whiteSpace: 'nowrap', visibility: hovered ? 'visible' : 'hidden' }}>
              홀딩
            </button>
          )}
        </div>
        <EditIconButton size={24} label="장비 수정" onClick={onEdit} />
      </div>

      {/* 서비스 노트 */}
      <div style={{
        fontSize: 13, color: '#111827', whiteSpace: 'pre-wrap',
        wordBreak: 'break-word', lineHeight: '20px',
      }}>
        {h.service_notes ?? '-'}
      </div>

      {/* 아랫줄: 날짜·참여자 한 줄 / 버튼은 그 아래 줄 */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 12, color: '#6b7280' }}>
          <span style={{ flexShrink: 0 }}>{h.visit_date ?? '-'}</span>
          {(() => {
            const names = h.service_engineers && h.service_engineers.length > 0
              ? h.service_engineers.map(se => `${se.engineers.name} ${se.engineers.position ?? ''}`.trim()).join(', ')
              : (h.visitor ?? '-')
            return (
              <>
                <span style={{ color: '#6b7280', flexShrink: 0 }}>·</span>
                {/* 이름이 길면 한 줄로 자른다. 전체는 title 로 본다 */}
                <span title={names} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names}</span>
              </>
            )
          })()}
        </div>

        {/* 파일 버튼 — 레포트 본체와 첨부를 「파일 N」 하나로 연다. 버튼 줄과 펼친 목록은 그 컴포넌트가 들고 있다.
            「레포트 작성」은 파일을 여는 것이 아니라 만드는 동작이라 같은 줄에 따로 둔다. */}
        <ServiceFilesButton
          attachments={h.service_attachments ?? []}
          report={h.report_url ? {
            fileName: reportDownloadName({
              visitDate: h.visit_date, companyName, serviceType: h.service_type, storedPath: h.report_url,
            }),
            busy: reportBusy, onOpen: onOpenReport,
          } : null}
          trailing={!h.report_url ? (
            <button
              onClick={onPrint}
              disabled={reportBusy}
              style={{
                padding: '4px 10px', background: '#fff', color: '#4b5563',
                borderRadius: R.icon, border: '1px solid #ebebeb',
                cursor: reportBusy ? 'default' : 'pointer', fontWeight: 600, fontSize: 12,
                flexShrink: 0, whiteSpace: 'nowrap', opacity: reportBusy ? 0.5 : 1,
              }}
            >
              {reportBusy ? '만드는 중…' : '레포트 작성'}
            </button>
          ) : undefined}
        />
      </div>
    </div>
  )
}

function DeviceCard({ d, companyName, deviceHistory, onEditDevice, onAddService, onEditService, onViewPhoto, onPrintReport, onOpenReport, reportBusyId, onUploadPacking, onOpenPacking, supabaseUrl, imageUrl, activeHolding, holdingByService, onAddHolding, onOpenHolding }: {
  d: Device
  companyName: string | null
  deviceHistory: ServiceHistory[]
  onEditDevice: () => void
  onAddService: () => void
  activeHolding: Holding | undefined
  holdingByService: Map<number, Holding>
  onAddHolding: (serviceId?: number | null) => void
  onOpenHolding: (h: Holding) => void
  onEditService: (s: ServiceHistory) => void
  /** 저장된 경로와 **지금 보이는 썸네일** 둘을 넘긴다 — 창이 원본을 따로 받는다. */
  onViewPhoto: (path: string, preview: string) => void
  onPrintReport: (s: ServiceHistory) => void
  reportBusyId: number | null
  onOpenReport: (s: ServiceHistory) => void
  onUploadPacking: (file: File) => void
  onOpenPacking: () => void
  supabaseUrl: string
  imageUrl: StorageImageLookup
}) {
  const deviceTitle = `${d.device_name ?? ''} ${d.device_name2 ?? ''} ${d.option ?? ''}`.replace(/\s+/g, ' ').trim()
  const defaultImg = getDefaultImageUrl(d, supabaseUrl)
  // 버킷이 비공개라 주소를 직접 못 만든다 — 부모가 묶음으로 받아 둔 서명 주소를 찾아 쓴다.
  const shownSrc = imageUrl(d.image_url) ?? imageUrl(defaultImg)
  // 사진이 있을 **예정**인가(주소를 아직 못 받았어도 자리를 잡아 둔다 — 테두리가 깜빡이지 않게).
  const hasPhoto = !!(d.image_url || defaultImg)
  const packingInputRef = useRef<HTMLInputElement | null>(null)
  /** 서비스 기록은 **기본이 접힘**이다 — 카드 넷이 한 화면에 들어와야 장비를 훑을 수 있다. */
  const [openHistory, setOpenHistory] = useState(false)
  /** 맨 위 한 줄에 쓰는 가장 최근 기록. 목록은 이미 정렬돼 있다(lib/serviceSort.ts). */
  const latest = deviceHistory[0]

  // 폐기된 장비는 **지워진 것이 아니라 쓰지 않는 것**이다 — 카드는 그대로 두고 바탕과
  // 글자만 죽인다(사진·버튼은 그대로 쓴다. 지난 레포트를 열어 볼 일이 남아 있다).
  const disposed = isDisposed(d)
  // 납품 예정 — **아직 없는 장비**다. 점선으로 두르고 예정월을 적는다(2026-11-26).
  // 예정월이 지났으면 「지연」으로 바꿔 빨갛게 — 누가 챙겨야 하는 줄이다.
  const pending = isPendingDelivery(d)
  const late = pending && isDeliveryLate(d.install_due_month, todayKST())

  return (
    /* 호버·키보드 포커스에 **공용 링**(2026-11-26 묶음2 D) — 전에는 장비 카드에
       호버 표시가 아예 없었다(안의 작은 단추만 반응했다). 납품 예정 카드의 점선은
       그대로다 — 링은 색만 바꾸고 선 모양은 건드리지 않는다. */
    <article className="ems-pick" style={{
      width: CARD_W, display: 'flex', flexDirection: 'column', flex: '0 0 auto',
      background: '#ffffff', border: pending ? '1px dashed #9ca3af' : '1px solid #ebebeb', borderRadius: R.card, overflow: 'hidden',
      position: 'relative',
      // 폐기 장비는 **지워진 것이 아니라 쓰지 않는 것**이다 — 카드를 죽여 두되 그대로 둔다
      // (지난 레포트를 열어 볼 일이 남아 있다).
      opacity: disposed ? 0.6 : 1,
    }}>
      {/* 수정 · 할 일 — 사진 위 오른쪽. 사진이 없을 때도 같은 자리다.
          「＋ 할 일」은 2026-11-26 에 왔다(F1) — 「랜포트 교체 PC 반입」 같은 약속을 이 장비에
          걸어 둔다. 창은 홈과 **같은 창**이고 이 장비가 박혀 열린다. */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
        <TaskAddButton
          preset={{ type: 'device', id: d.device_id, label: `${companyName ? `${companyName} » ` : ''}${deviceTitle || `장비 ${d.device_id}`}` }}
          kind="service"
          label="＋ 할 일"
        />
        <EditIconButton size={24} label="장비 수정" onClick={onEditDevice} />
      </div>

      {/*
        사진 — 카드 폭에 4:3.

        **전체가 보이게** 칸을 채운다(object-fit: fill, 2026-11-25 지시). cover 는 넘치는
        쪽을 잘라 내서, 가로로 긴 장비 사진은 양 끝이 사라졌다(어느 기종인지가 그 끝에
        있을 때가 있다). fill 은 비율이 살짝 눌리지만 **빠지는 것이 없다** — 비율 그대로
        보려면 눌러서 크게 본다(contain).

        누르면 **크게 보기**다. 사진이 없으면 점선 칸에 「사진 등록」이라고만 적는다 —
        눌러도 아무 일도 없다(올리는 일은 장비 수정 창에 있다).
      */}
      <div className="dev-photo" style={{
        width: '100%', height: PHOTO_H, boxSizing: 'border-box', overflow: 'hidden',
        ...(hasPhoto
          ? { background: '#f3f4f6' }
          : { margin: '10px 10px 0', width: 'auto', height: PHOTO_H - 10, border: '1px dashed #ebebeb', borderRadius: R.icon, background: '#fafafa' }),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasPhoto ? (
          shownSrc ? (
            <button type="button" onClick={() => onViewPhoto(d.image_url ?? defaultImg ?? '', shownSrc)} title="사진 크게 보기"
              style={{ width: '100%', height: '100%', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
              {/* 저장소(Supabase)의 장비 사진이다 — next/image 로 보내려면 원격 도메인을 설정에
                  등록해야 하고, 그 최적화는 **이 자리**에 이득이 없다(목록 썸네일 한 장, 이미
                  loading=lazy·decoding=async 다). 규칙만 이 줄에서 끈다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="dev-img" src={shownSrc} alt={deviceTitle || 'device'}
                loading="lazy" decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />
            </button>
          ) : null
        ) : (
          <div
            style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            {/* 안내색 — 「없다」를 알려 주는 글자다(lib/textTokens.ts 의 안내문·보조). */}
            <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>사진 등록</span>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {/* 납품 예정 태그 — 모델명 위. 지났으면 「지연」이다. */}
        {pending && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: R.tag, background: late ? '#fee2e2' : '#f3f4f6', color: late ? '#b91c1c' : '#4b5563', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {late ? `지연 · ${pendingLabel(d.install_due_month)}` : pendingLabel(d.install_due_month)}
            </span>
          </div>
        )}

        {/* 폐기 태그 — 모델명 위. 언제 뺀 장비인지가 곧 이력이다. */}
        {disposed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: R.tag, background: '#fee2e2', color: '#b91c1c', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {disposedLabel(d)}
            </span>
          </div>
        )}

        {/* ① 모델명 */}
        <b style={{
          fontSize: 15, fontWeight: 700, color: '#111827', display: 'block', textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={deviceTitle || '-'}>
          {deviceTitle || '-'}
        </b>

        {/* ② 납입 | S/N | 소프트웨어 */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: '#4b5563', minWidth: 0 }}>
          <span style={{ whiteSpace: 'nowrap' }}>납입 <b style={{ fontWeight: 600, color: '#111827' }}>{getInstallDisplay(d)}</b></span>
          <span style={{ color: '#6b7280' }}>|</span>
          <span style={{ whiteSpace: 'nowrap' }}>S/N <b style={{ fontWeight: 600, color: '#111827' }}>{d.serial_number ?? '-'}</b></span>
          <span style={{ color: '#6b7280' }}>|</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.program ?? '-'}</span>
        </div>

        {/* ③ 패킹리스트 | 최근 서비스 */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4, fontSize: 12, color: '#4b5563', minWidth: 0 }}>
          {d.packing_list_url ? (
            <button onClick={onOpenPacking} title="패킹리스트 열기"
              style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, color: '#234ea2', whiteSpace: 'nowrap' }}>
              <PaperclipGlyph />패킹리스트
            </button>
          ) : (
            <>
              <input ref={packingInputRef} type="file" accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPacking(f); e.target.value = '' }} />
              <button onClick={() => packingInputRef.current?.click()} title="납입의사록·패킹리스트 업로드"
                onMouseEnter={(e) => (e.currentTarget.style.color = '#234ea2')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
                style={{ padding: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, color: '#6b7280', transition: 'color 0.15s ease', whiteSpace: 'nowrap' }}>
                <PaperclipGlyph />패킹리스트 등록
              </button>
            </>
          )}
          <span style={{ color: '#6b7280' }}>|</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {latest
              ? <>최근 서비스 <b style={{ fontWeight: 600, color: '#111827' }}>{latest.visit_date ?? '날짜 미상'}{latest.service_type ? ` · ${latest.service_type}` : ''}</b></>
              : <span style={{ color: '#6b7280' }}>서비스 기록 없음</span>}
          </span>
        </div>
      </div>

      {/* 푸터 — 윗선 하나에 반반. 테두리·배경 없이 글자만 둔다(카드 안의 두 길이다). */}
      <div className="dev-actions" style={{ display: 'flex', borderTop: '1px solid #f1f5f9', marginTop: 'auto' }}>
        <button onClick={onAddService}
          onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          style={{
            flex: 1, height: 40, border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: '#234ea2', fontFamily: 'inherit',
            transition: 'background 0.15s ease',
          }}>
          ＋ 서비스 레포트
        </button>
        <span style={{ width: 1, background: '#f1f5f9', margin: '8px 0' }} />
        {/*
          기록 0건이면 펼칠 것이 없다 — 누를 수 없게 둔다(눌러도 아무 일이 없으면 고장으로 보인다).

          있을 때와 없을 때의 **생김새가 분명히 달라야** 한다(2026-11-22).
            1건 이상 — 왼쪽 「＋ 서비스 레포트」와 **같은 파랑 600**. 둘 다 누를 수 있는 길이다.
            0건      — 가장 흐린 회색(#d1d5db · 「빈 값」 자리의 색). 커서는 기본,
                       호버도 없다 — 누를 수 있는 것처럼 보이지 않게.
        */}
        <button onClick={() => setOpenHistory(v => !v)} disabled={deviceHistory.length === 0}
          aria-expanded={openHistory}
          onMouseEnter={e => { if (deviceHistory.length > 0) e.currentTarget.style.background = '#f8fafc' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          style={{
            flex: 1, height: 40, border: 'none', background: 'transparent', fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: deviceHistory.length === 0 ? 500 : 600,
            color: deviceHistory.length === 0 ? '#9ca3af' : '#234ea2',
            cursor: deviceHistory.length === 0 ? 'default' : 'pointer', transition: 'background 0.15s ease',
          }}>
          기록 {deviceHistory.length}{deviceHistory.length > 0 ? (openHistory ? ' ▴' : ' ▾') : ''}
        </button>
      </div>

      {/* 서비스 기록 — **기본은 접힘**. 펼친 줄의 기능은 그대로다
          (종류·유무상·홀딩·날짜·담당자·내용·수정·레포트 작성). */}
      {openHistory && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px 14px', borderTop: '1px solid #f1f5f9' }}>
          {deviceHistory.map((h) => (
            <ServiceCard
              key={`${d.device_id}-${h.service_id}`}
              h={h}
              companyName={companyName}
              onEdit={() => onEditService(h)}
              reportBusy={reportBusyId === h.service_id}
              onPrint={() => onPrintReport(h)}
              onOpenReport={() => onOpenReport(h)}
              holding={holdingByService.get(h.service_id)}
              onAddHolding={() => onAddHolding(h.service_id)}
              onOpenHolding={() => {
                const linked = holdingByService.get(h.service_id)
                if (linked) onOpenHolding(linked)
              }}
            />
          ))}
        </div>
      )}

      {/* 진행 중 홀딩 — 카드 맨 아래 한 줄. 어느 장비가 멈춰 있는지가 먼저 보여야 한다. */}
      {activeHolding && (
        <div style={{ padding: '0 14px 12px' }}>
          <button onClick={() => onOpenHolding(activeHolding)} title={activeHolding.title}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', fontSize: 11, fontWeight: 700, color: '#4b5563', background: '#f3f4f6', border: 'none', borderRadius: R.pill, padding: '3px 10px', cursor: 'pointer' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>홀딩 · {activeHolding.title}</span>
            <span style={{ flexShrink: 0, color: '#6b7280' }}>{elapsedLabel(activeHolding)}</span>
          </button>
        </div>
      )}
    </article>
  )
}

export default function DeviceSection({ devices, companyName, historyByDevice, onAddDevice, onEditDevice, onAddService, onEditService, onViewPhoto, onPrintReport, onOpenReport, reportBusyId, onUploadPacking, onOpenPacking, activeHoldingByDevice, holdingByService, onAddHolding, onOpenHolding, showDisposed = false }: Props) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  /**
   * 보여 줄 장비 — 폐기된 것은 **살아 있는 것 뒤**에 세운다(쓰는 장비가 먼저다).
   * 「폐기 포함」 스위치는 이 자리에 있었는데 **사업장 수정 모달 안의 체크**로 옮겼다
   * (2026-11-20) — 장비를 훑는 자리에 늘 떠 있을 만큼 자주 쓰는 스위치가 아니다.
   */
  const shown = showDisposed
    ? [...inUseOnly(devices), ...disposedOnly(devices)]
    : inUseOnly(devices)
  // 장비 사진 — 카드마다 서명을 받으면 요청이 장비 수만큼 늘어난다. 여기서 **한 번에** 받는다
  // (올린 사진 + 기종 카탈로그 사진 둘 다).
  const imageUrl = useDeviceImageUrls(
    shown.flatMap(d => [d.image_url, getDefaultImageUrl(d, supabaseUrl)]),
    deviceImageWidthFor(CARD_IMG_W),
  )

  // 섹션 제목도, 바깥 여백도 두지 않는다 — 업체 상세의 탭 라벨('장비 N')과 중복이고,
  // 감싸는 카드가 안쪽 여백을 갖기 때문이다.
  return (
    <div>

      {/* 카드는 **폭이 고정**이고 왼쪽부터 채운다(2026-11-20).
          늘리지 않는 까닭: 한 줄에 몇 장이 서느냐에 따라 카드 크기가 달라지면
          같은 장비가 화면마다 다르게 보인다. align-items: flex-start 라
          한 줄 안에서 키 큰 카드를 따라 늘어나지도 않는다. */}
      <div className="dev-grid">
        {shown.map((d) => (
          <DeviceCard
            key={d.device_id}
            d={d}
            companyName={companyName}
            deviceHistory={historyByDevice.get(d.device_id) || []}
            onEditDevice={() => onEditDevice(d)}
            onAddService={() => onAddService(d.device_id)}
            onEditService={onEditService}
            reportBusyId={reportBusyId}
            onViewPhoto={(p, preview) => onViewPhoto(d, p, preview)}
            imageUrl={imageUrl}
            onPrintReport={(s) => onPrintReport(s, d)}
            onOpenReport={(s) => onOpenReport(s)}
            onUploadPacking={(file) => onUploadPacking(d, file)}
            onOpenPacking={() => onOpenPacking(d)}
            activeHolding={activeHoldingByDevice.get(d.device_id)}
            holdingByService={holdingByService}
            onAddHolding={(serviceId) => onAddHolding(d.device_id, serviceId ?? null)}
            onOpenHolding={onOpenHolding}
            supabaseUrl={supabaseUrl}
          />
        ))}

        {/* 장비 추가 버튼 */}
        <button
          onClick={onAddDevice}
          style={{
            width: CARD_W, flex: '0 0 auto', minHeight: PHOTO_H + 137,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'transparent', border: '1px dashed #d1d5db', borderRadius: R.card,
            cursor: 'pointer', color: '#4b5563', fontSize: 13, fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#9ca3af'
            e.currentTarget.style.background = '#fafafa'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#d1d5db'
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          장비 추가
        </button>
      </div>
    </div>
  )
}
