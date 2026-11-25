'use client'

// 고객사 **상세 본문** — 정보·담당자·요약 / 활동 이력·장비 탭 / 모든 모달.
//
// ── 왜 떼어 냈나 ──────────────────────────────────────────────────────────
//   같은 내용을 두 곳에서 본다.
//     · 라우트  /customer/[id]            — 한 화면 전체
//     · 분할 보기 /?view=list 의 오른쪽 칸 — 왼쪽 트리에서 사업장을 고르면
//   둘이 각자 그리면 한쪽만 고쳐져 조용히 갈린다(메모·대리점 줄이 그랬다).
//   그래서 **본문은 이 파일 하나**이고, 라우트는 이것을 감싸기만 한다.
//
// ── embedded 가 바꾸는 것 ─────────────────────────────────────────────────
//   바깥 여백과 가로 폭 규칙만 다르다. 라우트는 화면 전체(100vh, 2단 1600px 상한)이고,
//   분할 보기는 **칸 안**이라 칸 폭을 기준으로 접힌다 — 화면 폭으로 접으면 1366 에서도
//   오른쪽 칸은 600px 인데 2단을 고집하게 된다. 그래서 그때만 컨테이너 쿼리를 쓴다.

import { useEffect, useRef, useState, useCallback } from 'react'

import { useCustomerDetail } from '@/hooks/customer/useCustomerDetail'
import { useServiceCrud } from '@/hooks/customer/useServiceCrud'
import { useContactCrud } from '@/hooks/customer/useContactCrud'
import { useDeviceCrud } from '@/hooks/customer/useDeviceCrud'
import { useCustomerCrud } from '@/hooks/customer/useCustomerCrud'
import { useHoldingCrud } from '@/hooks/customer/useHoldingCrud'
import { canViewMenu } from '@/lib/permissions'
import { useMe } from '@/lib/appData/MeProvider'

import type { Device, ServiceHistory } from '@/components/customer/types'
import { PAGE_BG, TEXT_MUTED } from '@/components/customer/constants'

import SiteHeaderBand from '@/components/customer/SiteHeaderBand'
import SiteInfoColumn, { SITE_COL_W } from '@/components/customer/SiteInfoColumn'
import DeletedDevices from '@/components/customer/DeletedDevices'
import DeviceSection from '@/components/customer/DeviceSection'
import { inUseOnly } from '@/lib/deviceStatus'
import HoldingModal from '@/components/customer/modals/HoldingModal'
import HoldingResolveModal from '@/components/customer/modals/HoldingResolveModal'
import CustomerEditModal from '@/components/customer/modals/CustomerEditModal'
import DeleteCustomerModal from '@/components/home/list/DeleteCustomerModal'
import ContactAddModal from '@/components/customer/modals/ContactAddModal'
import ContactEditModal from '@/components/customer/modals/ContactEditModal'
import DeviceAddModal from '@/components/customer/modals/DeviceAddModal'
import DeviceEditModal from '@/components/customer/modals/DeviceEditModal'
import ServiceAddModal from '@/components/customer/modals/ServiceAddModal'
import ServiceEditModal from '@/components/customer/modals/ServiceEditModal'
import SignModal from '@/components/customer/modals/SignModal'
import DevicePhotoModal from '@/components/customer/modals/DevicePhotoModal'
import { R } from '@/lib/radius'

export type CustomerDetailBodyProps = {
  customerId: number
  /** 제목 앞 화살표 — 라우트는 목록으로 가고, 분할 보기는 회사 보기로 돌아간다. */
  onBack?: () => void
  /** 이 화면에서 무언가 고쳤다 — 바깥 화면(목록 보기)이 자기 자료를 다시 읽게 한다. */
  onChanged?: () => void
  /** 칸 안에 끼워 그릴 때(분할 보기). 바깥 여백과 접히는 기준만 달라진다. */
  embedded?: boolean
  /**
   * 열자마자 **그 담당자 수정 창**을 연다(2026-11-25).
   * 견적 저장 창의 「담당자 정보에서 추가」가 ?contact=<id> 로 보낸다.
   */
  openContactId?: number | null
}

export default function CustomerDetailBody({
  customerId, onBack, onChanged, embedded = false, openContactId = null,
}: CustomerDetailBodyProps) {
  // 바깥 틀 — 라우트는 화면 전체, 분할 보기는 칸 안이다.
  // 'site-page' — 폰에서 바깥 여백을 12 로 줄이는 자리(아래 globalCss).
  const wrapClass = embedded ? 'cust-embed' : 'site-page'
  const wrapStyle: React.CSSProperties = embedded
    ? { padding: 0, background: 'transparent' }
    : { padding: '20px 24px', background: PAGE_BG, minHeight: '100vh' }

  const detail = useCustomerDetail(customerId)
  const {
    customer, devices, contacts, history, engineers,
    family, childSites,
    holdings, activeHoldingByDevice, holdingByService,
    loading, currentUserEngineerId, currentUserRole,
    historyByDevice, fetchDetail,
  } = detail

  /**
   * **되살리기는 관리 메뉴를 가진 사람**(+슈퍼관리자)이다 — 라우트와 같은 판정이다
   * (app/api/customer-delete 의 ADMIN_ACTIONS). 지우기·고치기는 로그인한 사람 전부에게
   * 열었지만(2026-11-25 지시), 되살리는 일은 지운 사람이 아니라 전체를 보는 사람이
   * 판단한다. permission_level 하나로는 못 가린다 — 메뉴 권한은 me.perm 에 있다.
   */
  const { me } = useMe()
  const canRestoreDevice = canViewMenu(me, 'admin')

  // 건수·요약은 **쓰는 장비만** 센다. 목록(DeviceSection)과 타임라인은 폐기까지 받아 간다 —
  // 목록은 「폐기 포함」 토글을 갖고, 타임라인은 지난 기록의 장비 이름을 여기서 찾는다.
  /**
   * 폐기 장비도 볼까 — 스위치는 **사업장 수정 모달 안의 체크**다(2026-11-20).
   * 값은 이 화면이 들고 있어, 모달을 닫아도 보던 대로 남는다.
   */
  const [showDisposed, setShowDisposed] = useState(false)
  const disposedCount = devices.length - inUseOnly(devices).length

  /**
   * 문구함 자리표의 값(2026-11-25) — 사업장·회사·장비·작성자는 **이 화면이** 안다.
   * 수신인·직급·오늘은 레포트 창이 고른 담당자와 날짜로 채운다.
   */
  const snippetCtx = (deviceId: number | null) => {
    const dev = deviceId != null ? devices.find(d => d.device_id === deviceId) : null
    return {
      사업장: customer?.company_name ?? '',
      회사: customer?.company_name ?? '',
      장비: [dev?.device_name, dev?.device_name2].filter(Boolean).join(' '),
      작성자: engineers.find(e => e.engineer_id === currentUserEngineerId)?.name ?? '',
    }
  }

  const holding = useHoldingCrud({ customerId, holdings, engineerId: currentUserEngineerId, fetchDetail, activeHoldingByDevice, role: currentUserRole })
  const service = useServiceCrud({
    customerId, customer, contacts, engineers, fetchDetail,
    onActiveHoldingFound: h => holding.openResolve(h, '이 장비에 홀딩 중인 건이 있습니다. 해제할까요?'),
  })
  /**
   * **고친 뒤 다시 읽기 — 한 길**(2026-11-23).
   * 이 화면 자기 자료(fetchDetail)를 읽고, 이어서 바깥 화면에도 알린다(onChanged).
   * 목록 보기 가운데 pane 으로 떠 있을 때 좌측 트리·지도·건수 배지가 그 알림으로 따라온다.
   * 훅마다 따로 알리지 않는다 — 한 함수를 넷이 나눠 쓴다.
   */
  const refreshAll = useCallback(async () => {
    const r = await fetchDetail()
    onChanged?.()
    return r
  }, [fetchDetail, onChanged])
  /**
   * 주소로 받은 담당자 — 열자마자 **그 담당자 수정 창**을 연다(2026-11-25).
   * 견적 저장 창의 「담당자 정보에서 추가」가 ?contact=<id> 로 보낸다. 한 번만 연다.
   */
  const openedContact = useRef(false)
  const contact = useContactCrud({
    customerId, fetchDetail: refreshAll,
    // 명함첩에도 담을 때 쓰는 밑값 — 사람 쪽은 폼이, 회사·주소는 이 사업장이 준다.
    site: { company: customer?.company_name ?? null, address: customer?.address ?? null },
  })
  useEffect(() => {
    if (!openContactId || openedContact.current) return
    const found = contacts.find(c => c.contact_id === openContactId)
    if (!found) return
    openedContact.current = true
    contact.setSelectedContact(found)
  }, [openContactId, contacts, contact])

  const device = useDeviceCrud({ customerId, fetchDetail: refreshAll })
  const customerCrud = useCustomerCrud({ customer, fetchDetail: refreshAll })

  // ── 이 화면에서만 쓰는 상태 ──
  // 활동 이력 탭은 걷었다(2026-11-20). 활동은 **회사 화면의 전체 타임라인**에서 본다 —
  // 한 사업장만 떼어 보면 같은 고객사의 다른 사업장에서 벌어진 일이 보이지 않고,
  // 같은 타임라인을 두 곳에서 따로 고쳐야 했다. 여기는 장비만 남는다.
  /** 요약의 「장비」 숫자를 누르면 이 카드로 내려간다(전에는 탭을 바꿨다). */
  const deviceCardRef = useRef<HTMLDivElement | null>(null)
  /** 크게 보고 있는 장비 사진 — 카드의 사진을 누르면 담긴다(2026-11-25). */
  const [photo, setPhoto] = useState<{ path: string; preview: string; alt: string } | null>(null)
  const [isSignModalOpen, setIsSignModalOpen] = useState(false)
  const [pendingReportService, setPendingReportService] = useState<ServiceHistory | null>(null)
  const [pendingReportDevice, setPendingReportDevice] = useState<Device | null>(null)

  const globalCss = `
    html, body { background: ${PAGE_BG}; }
    input::placeholder, textarea::placeholder { color: ${TEXT_MUTED}; opacity: 1; }
    /* select { appearance: none } 은 지웠다 — 다크 테마 잔재인데 대신 그릴 화살표를
       두지 않아 드롭다운이 그냥 텍스트 칸으로 보였다(고객사 수정·기기·활동 모달의 선택 칸).
       app/page.tsx 에서도 같은 이유로 지웠다(2026-09-29). */
    input[type="date"]::-webkit-calendar-picker-indicator { cursor: pointer; }
    input:focus, textarea:focus, select:focus {
      border-color: #234ea2 !important;
      box-shadow: 0 0 0 3px rgba(35,78,162,0.10) !important;
      outline: none;
    }
    @keyframes modal-in {
      from { opacity: 0; transform: scale(0.97) translateY(6px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes sk-pulse { 0%,100% { opacity:1 } 50% { opacity:0.45 } }

    /*
      ── V8(2026-11-25) — PC 는 **좌 340 열 + 우 장비**다 ───────────────────
      2026-11-20 에는 왼쪽 열을 걷고 가로 띠로 눕혔다(그 열이 가져간 300px 만큼 장비가
      좁았다). 그런데 띠는 담당자를 칩 두 줄로 접어야 해서, 다섯 명이면 「더보기 +3」이
      되고 전화·이메일이 칩 안에서 자리를 다퉜다. 사업장 화면에서 가장 자주 하는 일이
      「담당자에게 전화」다 — 그래서 열을 되살리되 **장비 카드와 같은 폭(340)** 으로
      못 박았다. 1440 에서 오른쪽에 카드 셋이 선다.

      기본(폰)은 **한 단**이고 지난 회차의 가로 띠(SiteHeaderBand)가 그대로 선다.
      둘은 CSS 로만 갈린다 — 넓어지면 띠가 사라지고 열이 선다.

      접는 기준이 두 벌인 까닭: 상세 페이지(.site-page)는 **화면 폭**으로 접고,
      분할 보기(.cust-embed)는 **칸 폭**으로 접는다(@container). 1366 에서도 오른쪽
      칸은 600px 인데 화면 폭으로 접으면 2단을 고집하다 장비 카드가 칸을 넘친다.

      칸의 문턱은 **1000**이다(2026-11-26). 768 로 두었더니 1280 화면의 분할 보기에서
      칸이 808px 이라, 좌 열 340 을 빼면 장비 카드가 한 줄에 한 장만 섰다. 열(340) +
      카드 둘(320·320) + 사이 여백이 들어가는 폭이 1000 쯤이다 — 그보다 좁으면 지난
      회차의 가로 띠(HeaderBand)로 돌아간다.
    */
    .site-wrap { display: flex; flex-direction: column; gap: 12px; max-width: 1920px; margin: 0 auto; }
    .cust-center { min-width: 0; }
    .site-col-wrap { display: none; min-width: 0; }
    @media (min-width: 768px) {
      .site-page .site-wrap { display: grid; grid-template-columns: ${SITE_COL_W}px minmax(0, 1fr); gap: 14px; align-items: start; }
      .site-page .site-col-wrap { display: block; position: sticky; top: 14px; }
      .site-page .site-band-phone { display: none; }
    }
    @container (min-width: 1000px) {
      .cust-embed .site-wrap { display: grid; grid-template-columns: ${SITE_COL_W}px minmax(0, 1fr); gap: 14px; align-items: start; }
      .cust-embed .site-col-wrap { display: block; position: sticky; top: 14px; }
      .cust-embed .site-band-phone { display: none; }
    }

    /* 장비 카드는 **폭 340 고정**이다. 남는 자리에 맞춰 늘리지 않고 왼쪽부터 채운다 —
       한 줄에 몇 장이 서느냐에 따라 카드가 달라지면 같은 장비가 화면마다 다르게 보인다.
       align-items: flex-start 라 한 줄 안에서 키 큰 카드를 따라 늘어나지도 않는다
       (기록을 펼친 카드 옆의 카드가 함께 길어지던 자리다). */
    .dev-grid { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; align-content: flex-start; }
    .cust-embed { container-type: inline-size; }
    /* 폰에서는 폭을 화면에 맞춘다 — 340 을 고집하면 가로로 넘친다. */
    @media (max-width: 640px) {
      .dev-grid { gap: 10px }
      .dev-grid > * { width: 100% !important; }
    }

    /* 폰(≤640) — 현장에서 쓰는 화면이다. 누르는 것은 44px 이상으로 키운다.
       서비스 레포트 추가는 한 줄을 다 쓰고, 기록 토글은 그 아래 같은 높이로 선다. */
    @media (max-width: 640px) {
      .site-wrap { gap: 10px; }
      /* 앱바 바로 아래 **12px** 뒤에 카드가 시작한다(2026-11-25 지시). 전에는 20·24 였다. */
      .site-page { padding: 12px !important; }
      /* 장비 사진은 카드 폭에 **4:3** — 폭이 340 을 넘는 폰에서는 높이 고정이 어긋난다. */
      .dev-photo { height: auto !important; aspect-ratio: 4 / 3; }
      /* 고정 하단 버튼이 있는 화면은 홈바만큼만 띄운다. */
      .site-wrap { padding-bottom: env(safe-area-inset-bottom); }
      .dev-actions { flex-wrap: wrap; }
      .dev-actions > button:first-child { flex: 1 0 100%; height: 44px !important; font-size: 14px; }
      .dev-actions > button:last-child { flex: 1 0 100%; height: 44px !important; font-size: 13px; }
    }
  `

  if (loading) {
    return (
      <>
        <style jsx global>{globalCss}</style>
        <div className={wrapClass} style={wrapStyle}>
          {[{ h: 130, mb: 24 }, { h: 120, mb: 24 }, { h: 400, mb: 0 }].map(({ h, mb }, i) => (
            <div key={i} style={{
              background: '#ffffff', borderRadius: R.modal, height: h, marginBottom: mb,
              border: '1px solid #e5e7eb',
              animation: 'sk-pulse 1.6s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }} />
          ))}
        </div>
      </>
    )
  }

  // 부모 행은 사업장을 묶기만 하는 껍데기다(주소·장비·견적이 없다).
  // 일반 상세를 그대로 보여주면 빈 화면이 되므로, 무엇인지 알려주고 사업장만 낸다.
  if (customer?.is_parent) {
    return (
      <>
        <style jsx global>{globalCss}</style>
        <div className={wrapClass} style={wrapStyle}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: R.control, padding: '14px 16px' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', marginBottom: 6 }}>
                {customer.company_name}
              </div>
              <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.7 }}>
                사업장을 묶는 회사입니다.
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: R.control, padding: '14px 16px', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>사업장</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px' }}>
                  {childSites.length}곳
                </span>
              </div>
              {childSites.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
                  묶인 사업장이 없습니다
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {childSites.map(c => (
                    <a key={c.customer_id}
                      href={`/customer/${c.customer_id}`}
                      style={{
                        textDecoration: 'none',
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '9px 8px', background: 'none', border: 'none', borderBottom: '1px solid #ebebeb',
                        cursor: 'pointer', fontSize: 13, color: '#111827', fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.company_name ?? '-'}
                      </span>
                      <span style={{ color: '#6b7280', flexShrink: 0 }}>→</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <style jsx global>{globalCss}</style>

      <div className={wrapClass} style={wrapStyle}>

        {/* 넓으면 **좌 340 열 + 우 장비**(V8), 폰에서는 가로 띠 아래를 장비가 전부 쓴다.
            같은 내용을 두 모양으로 그리는 자리라 하네스가 둘을 함께 본다(site-v8-check.js). */}
        <div className="site-wrap">
          {/* 폰 — 지난 회차의 가로 띠 그대로다(≥768 에서는 CSS 가 감춘다). */}
          <div className="site-band-phone">
            <SiteHeaderBand
              customer={customer}
              companyName={family?.name ?? null}
              contacts={contacts}
              onBack={onBack}
              /* 회사명을 누르는 것과 ← 는 같은 곳으로 간다(분할 보기의 회사 화면).
                 둘 다 두는 까닭: ← 는 「돌아가기」, 회사명은 「이 사업장이 어느 회사인가」다. */
              onOpenCompany={embedded ? onBack : undefined}
              onEdit={() => customerCrud.setIsEditCustomerModalOpen(true)}
              onAddContact={() => contact.setIsAddContactModalOpen(true)}
              onEditContact={contact.setSelectedContact}
            />
          </div>

          {/* PC — 따라 내려오는 왼쪽 열(사업장 정보 + 담당자). */}
          <div className="site-col-wrap">
            <SiteInfoColumn
              customer={customer}
              companyName={family?.name ?? null}
              contacts={contacts}
              onBack={onBack}
              onOpenCompany={embedded ? onBack : undefined}
              onEdit={() => customerCrud.setIsEditCustomerModalOpen(true)}
              onAddContact={() => contact.setIsAddContactModalOpen(true)}
              onEditContact={contact.setSelectedContact}
            />
          </div>

          {/* 장비 — 머리줄을 두지 않는다. 장비 수는 왼쪽 열에 있고, 더하는 자리는 그리드 끝 점선 카드다. */}
          <div className="cust-center" ref={deviceCardRef}>
        <DeviceSection
          devices={devices}
          companyName={customer?.company_name ?? null}
          historyByDevice={historyByDevice}
          onAddDevice={() => device.setIsAddDeviceModalOpen(true)}
          onEditDevice={device.setSelectedDevice}
          onAddService={service.setSelectedDeviceId}
          onEditService={service.setSelectedService}
          onViewPhoto={(dev, p, preview) => setPhoto({ path: p, preview, alt: [dev.device_name, dev.device_name2].filter(Boolean).join(' ') || '장비 사진' })}
          onPrintReport={(svc, dev) => {
            setPendingReportService(svc)
            setPendingReportDevice(dev)
            setIsSignModalOpen(true)
          }}
          onOpenReport={service.handleOpenReport}
          reportBusyId={service.reportBusyId}
          onUploadPacking={device.handleUploadPacking}
          onOpenPacking={device.handleOpenPacking}
          activeHoldingByDevice={activeHoldingByDevice}
          holdingByService={holdingByService}
          onAddHolding={holding.openNewHolding}
          onOpenHolding={holding.openHolding}
          showDisposed={showDisposed}
        />
        {/* 그리드 끝 — 숨긴 장비를 되살리는 줄(관리 메뉴를 가진 사람에게만 보인다). */}
        <DeletedDevices customerId={customerId} canRestore={canRestoreDevice} onRestored={refreshAll} />
          </div>
        </div>

        {/* ── 모달 ── */}
        <CustomerEditModal
          showDisposed={showDisposed}
          onToggleDisposed={() => setShowDisposed(v => !v)}
          disposedCount={disposedCount}
          customer={customerCrud.isEditCustomerModalOpen ? customer : null}
          isSaving={customerCrud.isSavingCustomerEdit}
          isDeleting={customerCrud.isDeletingCustomer}
          onClose={() => customerCrud.setIsEditCustomerModalOpen(false)}
          onSave={customerCrud.handleUpdateCustomer}
          onDelete={customerCrud.openDeleteCustomer}
        />
        {/* 담당자·장비 지우기 창 — 사업장 창과 같은 부품이다. */}
        {contact.deleteContactOpen && contact.selectedContact && (
          <DeleteCustomerModal
            key={`contact-${contact.selectedContact.contact_id}`}
            target="contact"
            name={contact.selectedContact.name ?? ''}
            counts={null}
            busy={contact.isSavingContactEdit}
            onClose={() => contact.setDeleteContactOpen(false)}
            onDelete={reason => void contact.confirmDeleteContact(reason)}
          />
        )}
        {device.deleteDeviceOpen && device.selectedDevice && (
          <DeleteCustomerModal
            key={`device-${device.selectedDevice.device_id}`}
            target="device"
            name={[device.selectedDevice.device_name, device.selectedDevice.device_name2].filter(Boolean).join(' ')}
            counts={null}
            busy={device.isSavingDeviceEdit}
            onClose={() => device.setDeleteDeviceOpen(false)}
            onDelete={reason => void device.confirmDeleteDevice(reason)}
          />
        )}

        {/* 지우기 창 — 무엇이 함께 숨는지 보여 주고 까닭을 받는다(2026-11-23). */}
        {customerCrud.deleteOpen && customer && (
          <DeleteCustomerModal
            target="site"
            name={customer.company_name ?? ''}
            counts={customerCrud.deleteCounts}
            busy={customerCrud.isDeletingCustomer}
            onClose={() => customerCrud.setDeleteOpen(false)}
            onDelete={reason => void customerCrud.confirmDeleteCustomer(reason)}
            /* 창이 「이탈로 바꾸세요」라고 말한다 — 그 길을 같은 창에 둔다(사업장에만). */
            onLeave={() => void customerCrud.leaveSite()}
          />
        )}
        <ContactAddModal
          isOpen={contact.isAddContactModalOpen}
          isSaving={contact.isSavingContact}
          onClose={() => contact.setIsAddContactModalOpen(false)}
          onSave={contact.handleAddContact}
        />
        <ContactEditModal
          contact={contact.selectedContact}
          isSaving={contact.isSavingContactEdit}
          onClose={() => contact.setSelectedContact(null)}
          onSave={contact.handleUpdateContact}
          onDelete={contact.openDeleteContact}
        />
        <DeviceAddModal
          isOpen={device.isAddDeviceModalOpen}
          isSaving={device.isSavingDevice}
          onClose={() => device.setIsAddDeviceModalOpen(false)}
          onSave={device.handleAddDevice}
        />
        <DeviceEditModal
          device={device.selectedDevice}
          isSaving={device.isSavingDeviceEdit}
          onClose={() => device.setSelectedDevice(null)}
          onSave={device.handleUpdateDevice}
          onDelete={device.openDeleteDevice}
          onDispose={device.handleDisposeDevice}
          onRestore={device.handleRestoreDevice}
          onOpenPacking={() => device.selectedDevice && device.handleOpenPacking(device.selectedDevice)}
          onImageChanged={fetchDetail}
        />
        <ServiceAddModal
          snippetCtx={snippetCtx(service.selectedDeviceId)}
          deviceId={service.selectedDeviceId}
          contacts={contacts}
          engineers={engineers}
          currentUserEngineerId={currentUserEngineerId}
          isSaving={service.isSavingService}
          onClose={() => service.setSelectedDeviceId(null)}
          onSave={service.handleAddService}
        />
        <ServiceEditModal
          snippetCtx={snippetCtx(service.selectedService?.device_id ?? null)}
          service={service.selectedService}
          onOpenReport={() => service.selectedService && service.handleOpenReport(service.selectedService)}
          onDeleteReport={() => service.selectedService && service.handleDeleteReport(service.selectedService)}
          contacts={contacts}
          engineers={engineers}
          isSaving={service.isSavingServiceEdit}
          onClose={() => service.setSelectedService(null)}
          onSave={service.handleUpdateService}
          onAttachmentsChanged={fetchDetail}
          onDelete={service.handleDeleteService}
        />
        <SignModal
          isOpen={isSignModalOpen}
          onClose={() => {
            setIsSignModalOpen(false)
            setPendingReportService(null)
            setPendingReportDevice(null)
          }}
          onComplete={async (engineerSign, customerSign) => {
            setIsSignModalOpen(false)
            if (pendingReportService && pendingReportDevice) {
              await service.handlePrintReport(pendingReportService, pendingReportDevice, engineerSign, customerSign)
            }
            setPendingReportService(null)
            setPendingReportDevice(null)
          }}
        />
        <HoldingModal
          isOpen={holding.isHoldingModalOpen}
          holding={holding.viewingHolding}
          targetDeviceName={
            holding.newHoldingTarget
              ? (devices.find(d => d.device_id === holding.newHoldingTarget!.deviceId)?.device_name ?? '-')
              : '-'
          }
          linkedService={
            (() => {
              const sid = holding.viewingHolding?.service_id ?? holding.newHoldingTarget?.serviceId ?? null
              return sid == null ? null : (history.find(h => h.service_id === sid) ?? null)
            })()
          }
          isSaving={holding.isSavingHolding}
          onClose={holding.closeHoldingModal}
          onCreate={holding.handleCreateHolding}
          onUpdateHolding={holding.handleUpdateHolding}
          onAddNote={holding.handleAddNote}
          onRequestResolve={h => holding.openResolve(h)}
          reports={holding.holdingReports}
          reportsLoading={holding.reportsLoading}
          onOpenReport={holding.handleOpenReport}
          canEditNote={holding.canEditNote}
          onUpdateNote={holding.handleUpdateNote}
          onDeleteNote={holding.handleDeleteNote}
          onReopen={holding.handleReopen}
          canDelete={!!holding.viewingHolding && holding.canDeleteHolding(holding.viewingHolding)}
          onDeleteHolding={holding.handleDeleteHolding}
        />
        <HoldingResolveModal
          isOpen={!!holding.resolveTarget}
          holding={holding.resolveTarget}
          notice={holding.resolveNotice}
          isSaving={holding.isSavingHolding}
          onClose={holding.closeResolve}
          onResolve={holding.handleResolve}
        />
        {/* 사진 크게 보기 — 사진만 띄운다(등록·변경은 장비 수정 창에 있다, 2026-11-25). */}
        <DevicePhotoModal photo={photo} onClose={() => setPhoto(null)} />

      </div>
    </>
  )
}
