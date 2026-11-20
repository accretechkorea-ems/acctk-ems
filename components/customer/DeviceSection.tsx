'use client'

import { useRef, useState } from 'react'
import { EditIconButton } from '@/components/common/IconButton'
import type { Device, Holding, ServiceHistory } from './types'
import { getInstallDisplay, getDefaultImageUrl } from './utils'
import { deviceImageWidthFor } from '@/lib/deviceImage'
import { isDisposed, disposedLabel, inUseOnly, disposedOnly } from '@/lib/deviceStatus'
import { useDeviceImageUrls, type StorageImageLookup } from '@/hooks/useStorageImageUrls'
import { R } from '@/lib/radius'

/** 카드 사진을 받을 폭(px) — 장비 카드 폭에 맞춘다. */
const CARD_IMG_W = 240
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
  onImageUpload: (device: Device) => void
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
}

function ServiceCard({ h, d, companyName, onEdit, onPrint, onOpenReport, reportBusy, holding, onAddHolding, onOpenHolding }: { h: ServiceHistory; d: Device; companyName: string | null; onEdit: () => void; onPrint: () => void; onOpenReport: () => void; reportBusy: boolean; holding: Holding | undefined; onAddHolding: () => void; onOpenHolding: () => void }) {
  const [hovered, setHovered] = useState(false)
  const sc = getCategoryColor(SERVICE_TYPE_COLORS, h.service_type)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', background: '#fff', borderRadius: R.control, padding: '12px 14px 12px 17px',
        border: `1px solid ${hovered ? '#c7d7f8' : '#ebebeb'}`,
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
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              <span style={{ color: '#d1d5db' }}> · </span>{h.is_paid ? '유상' : '무상'}
            </span>
          )}
          {/* 홀딩이 걸린 레포트는 배지를, 없으면 호버 시 등록 진입점을 보여준다 */}
          {holding ? (
            <button onClick={onOpenHolding} title={holding.title}
              style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {holding.resolved_at ? '홀딩 해제됨' : '홀딩 중'}
            </button>
          ) : (
            <button onClick={onAddHolding} title="이 건으로 홀딩"
              style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', background: 'none', border: '1px solid #ebebeb', borderRadius: R.pill, padding: '1px 8px', cursor: 'pointer', whiteSpace: 'nowrap', visibility: hovered ? 'visible' : 'hidden' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 12, color: '#9ca3af' }}>
          <span style={{ flexShrink: 0 }}>{h.visit_date ?? '-'}</span>
          {(() => {
            const names = h.service_engineers && h.service_engineers.length > 0
              ? h.service_engineers.map(se => `${se.engineers.name} ${se.engineers.position ?? ''}`.trim()).join(', ')
              : (h.visitor ?? '-')
            return (
              <>
                <span style={{ color: '#d1d5db', flexShrink: 0 }}>·</span>
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
                padding: '4px 10px', background: '#fff', color: '#6b7280',
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

function DeviceCard({ d, companyName, deviceHistory, onEditDevice, onAddService, onEditService, onImageUpload, onPrintReport, onOpenReport, reportBusyId, onUploadPacking, onOpenPacking, supabaseUrl, imageUrl, activeHolding, holdingByService, onAddHolding, onOpenHolding }: {
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
  onImageUpload: () => void
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

  return (
    <div style={{
      minWidth: 0, background: disposed ? '#fafafa' : '#ffffff', borderRadius: R.card, padding: '14px 16px',
      border: '1px solid #ebebeb', position: 'relative',
      alignSelf: 'flex-start',
    }}>
      {/* 수정 버튼 */}
      <EditIconButton size={24} label="장비 수정" onClick={onEditDevice}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 2 }} />

      {/* 이미지 영역 — 사진 변경·삭제는 장비 수정 모달에서 한다(카드 우측 위는 수정 아이콘 자리다) */}
      <div style={{
        height: 150, borderRadius: R.icon, background: 'transparent',
        border: hasPhoto ? 'none' : '1px dashed #ebebeb',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* 카드 폭만큼 줄여 받는다 — 서명 주소에 변환(width)을 붙여서(lib/deviceImage.ts).
            원본은 수정 모달이 쓴다. 주소를 받기 전에는 빈 칸으로 둔다. */}
        {hasPhoto ? (
          shownSrc ? (
            <img src={shownSrc} alt={deviceTitle || 'device'}
              loading="lazy" decoding="async"
              style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
          ) : null
        ) : (
          <button
            onClick={onImageUpload}
            style={{
              width: '100%', height: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>사진 등록</span>
          </button>
        )}
      </div>

      {/* 장비명 — 왼쪽 맞춤. 가운데 맞춤은 이름이 길어지면 아래 제원 줄과 축이 어긋났다. */}
      <div style={{
        fontSize: 15, fontWeight: 700, color: disposed ? '#6b7280' : '#111827',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 10,
      }} title={deviceTitle || '-'}>
        {deviceTitle || '-'}
      </div>

      {/* 폐기·홀딩 배지 — 있을 때만. */}
      {(disposed || activeHolding) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {disposed && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '3px 10px', whiteSpace: 'nowrap' }}>
              {disposedLabel(d)}
            </span>
          )}
          {activeHolding && (
            <button onClick={() => onOpenHolding(activeHolding)} title={activeHolding.title}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%', fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', border: 'none', borderRadius: R.pill, padding: '3px 10px', cursor: 'pointer' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>홀딩 · {activeHolding.title}</span>
              <span style={{ flexShrink: 0, color: '#9ca3af' }}>{elapsedLabel(activeHolding)}</span>
            </button>
          )}
        </div>
      )}

      {/* 제원 한 줄 — S/N · 소프트웨어 · 납입일. 패킹리스트는 그 뒤에 붙는다(기능 그대로). */}
      <div style={{ fontSize: 12, color: '#4b5563', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          S/N {d.serial_number ?? '-'}
          <span style={{ color: '#d1d5db' }}>{' · '}</span>{d.program ?? '-'}
          <span style={{ color: '#d1d5db' }}>{' · '}</span>납입 {getInstallDisplay(d)}
        </span>
        {d.packing_list_url ? (
          <button onClick={onOpenPacking} title="패킹리스트 열기"
            style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, color: '#234ea2' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span style={{ fontSize: 11 }}>패킹리스트</span>
          </button>
        ) : (
          <>
            <input ref={packingInputRef} type="file" accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadPacking(f); e.target.value = '' }} />
            <button onClick={() => packingInputRef.current?.click()} title="납입의사록·패킹리스트 업로드"
              onMouseEnter={(e) => (e.currentTarget.style.color = '#234ea2')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
              style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, color: '#9ca3af', transition: 'color 0.15s ease' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span style={{ fontSize: 11 }}>패킹리스트 등록</span>
            </button>
          </>
        )}
      </div>

      {/* 최근 서비스 한 줄 — 카드를 펼치지 않고도 「언제 무엇을 했나」를 알 수 있다. */}
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
        {latest ? (
          <>
            최근 서비스{' '}
            <b style={{ fontWeight: 600, color: '#111827' }}>
              {latest.visit_date ?? '날짜 미상'}{latest.service_type ? ` · ${latest.service_type}` : ''}
            </b>
          </>
        ) : (
          <span style={{ color: '#9ca3af' }}>서비스 기록 없음</span>
        )}
      </div>

      {/* 누르는 줄 — 주 버튼이 남는 자리를 전부 쓰고 기록 토글은 오른쪽에 붙는다. */}
      <div className="dev-actions" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={onAddService}
          style={{
            flex: 1, minWidth: 0, height: 34, padding: '0 12px', background: '#234ea2', color: '#fff',
            borderRadius: R.control, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
          }}>
          서비스 레포트 추가
        </button>
        {/* 기록 0건이면 펼칠 것이 없다 — 누를 수 없게 둔다(눌러도 아무 일이 없으면 고장으로 보인다). */}
        <button onClick={() => setOpenHistory(v => !v)} disabled={deviceHistory.length === 0}
          aria-expanded={openHistory}
          style={{
            flexShrink: 0, height: 34, padding: '0 10px', background: '#ffffff',
            color: deviceHistory.length === 0 ? '#9ca3af' : '#4b5563',
            border: '1px solid #ebebeb', borderRadius: R.control, fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
            cursor: deviceHistory.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}>
          기록 {deviceHistory.length}{deviceHistory.length > 0 ? (openHistory ? ' ▴' : ' ▾') : ''}
        </button>
      </div>

      {/* 서비스 기록 — **기본은 접힘**. 카드 넷이 한 화면에 들어오려면 기록이 접혀 있어야 한다.
          펼친 줄의 기능은 그대로다(종류·유무상·홀딩·날짜·담당자·내용·수정·레포트 작성). */}
      {openHistory && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {deviceHistory.map((h) => (
            <ServiceCard
              key={`${d.device_id}-${h.service_id}`}
              h={h}
              d={d}
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
    </div>
  )
}

export default function DeviceSection({ devices, companyName, historyByDevice, onAddDevice, onEditDevice, onAddService, onEditService, onImageUpload, onPrintReport, onOpenReport, reportBusyId, onUploadPacking, onOpenPacking, activeHoldingByDevice, holdingByService, onAddHolding, onOpenHolding }: Props) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  // 폐기 장비를 **이 목록에서만** 다시 볼 수 있다(다른 화면은 전부 사용중만 본다).
  // 기본은 꺼짐 — 쓰는 장비만 보이는 것이 평소의 모습이다.
  const [showDisposed, setShowDisposed] = useState(false)
  const disposedCount = disposedOnly(devices).length
  const shown = showDisposed ? devices : inUseOnly(devices)
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

      {/* 폐기 포함 토글 — 폐기된 장비가 하나도 없으면 두지 않는다(끌 것이 없는 스위치다). */}
      {disposedCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            onClick={() => setShowDisposed(v => !v)}
            style={{
              fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: R.icon, cursor: 'pointer',
              background: showDisposed ? '#f3f4f6' : '#fff',
              border: '1px solid #ebebeb',
              color: showDisposed ? '#111827' : '#9ca3af',
            }}
          >
            폐기 포함 {disposedCount}
          </button>
        </div>
      )}

      {/* 가로로 밀던 것을 **줄바꿈 그리드**로 바꿨다(2026-11-20) — 밀린 카드는
          스크롤하기 전까지 없는 것과 같았다. 칸은 최소 300px, 남는 자리를 고루 나눈다. */}
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
            onImageUpload={() => onImageUpload(d)}
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
            minWidth: 0, minHeight: 260,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'transparent', border: '1px dashed #d1d5db', borderRadius: R.card,
            cursor: 'pointer', color: '#6b7280', fontSize: 13, fontWeight: 600,
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
