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

import { useRef, useState } from 'react'

import { useCustomerDetail } from '@/hooks/customer/useCustomerDetail'
import { useServiceCrud } from '@/hooks/customer/useServiceCrud'
import { useContactCrud } from '@/hooks/customer/useContactCrud'
import { useDeviceCrud } from '@/hooks/customer/useDeviceCrud'
import { useCustomerCrud } from '@/hooks/customer/useCustomerCrud'
import { useHoldingCrud } from '@/hooks/customer/useHoldingCrud'
import { isSuperAdmin } from '@/lib/permissions'

import type { Device, ServiceHistory } from '@/components/customer/types'
import { PAGE_BG, TEXT_MUTED } from '@/components/customer/constants'

import { AddIconButton } from '@/components/common/IconButton'
import CustomerInfoPanel from '@/components/customer/CustomerInfoPanel'
import ContactSection from '@/components/customer/ContactSection'
import DeviceSection from '@/components/customer/DeviceSection'
import { inUseOnly } from '@/lib/deviceStatus'
import HoldingModal from '@/components/customer/modals/HoldingModal'
import HoldingResolveModal from '@/components/customer/modals/HoldingResolveModal'
import CustomerEditModal from '@/components/customer/modals/CustomerEditModal'
import ContactAddModal from '@/components/customer/modals/ContactAddModal'
import ContactEditModal from '@/components/customer/modals/ContactEditModal'
import DeviceAddModal from '@/components/customer/modals/DeviceAddModal'
import DeviceEditModal from '@/components/customer/modals/DeviceEditModal'
import ServiceAddModal from '@/components/customer/modals/ServiceAddModal'
import ServiceEditModal from '@/components/customer/modals/ServiceEditModal'
import SignModal from '@/components/customer/modals/SignModal'
import DeviceImageModal from '@/components/customer/modals/DeviceImageModal'
import { R } from '@/lib/radius'
import { TITLE } from '@/lib/textTokens'

export type CustomerDetailBodyProps = {
  customerId: number
  /** 제목 앞 화살표 — 라우트는 목록으로 가고, 분할 보기는 회사 보기로 돌아간다. */
  onBack?: () => void
  /** 칸 안에 끼워 그릴 때(분할 보기). 바깥 여백과 접히는 기준만 달라진다. */
  embedded?: boolean
}

export default function CustomerDetailBody({
  customerId, onBack, embedded = false,
}: CustomerDetailBodyProps) {
  // 바깥 틀 — 라우트는 화면 전체, 분할 보기는 칸 안이다.
  const wrapClass = embedded ? 'cust-embed' : ''
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

  // 건수·요약은 **쓰는 장비만** 센다. 목록(DeviceSection)과 타임라인은 폐기까지 받아 간다 —
  // 목록은 「폐기 포함」 토글을 갖고, 타임라인은 지난 기록의 장비 이름을 여기서 찾는다.
  const activeDevices = inUseOnly(devices)

  const holding = useHoldingCrud({ customerId, holdings, engineerId: currentUserEngineerId, fetchDetail, activeHoldingByDevice, role: currentUserRole })
  const service = useServiceCrud({
    customerId, customer, contacts, engineers, fetchDetail,
    onActiveHoldingFound: h => holding.openResolve(h, '이 장비에 홀딩 중인 건이 있습니다. 해제할까요?'),
  })
  const contact = useContactCrud({ customerId, fetchDetail })
  const device = useDeviceCrud({ customerId, fetchDetail })
  const customerCrud = useCustomerCrud({ customer, fetchDetail })

  // ── 이 화면에서만 쓰는 상태 ──
  // 활동 이력 탭은 걷었다(2026-11-20). 활동은 **회사 화면의 전체 타임라인**에서 본다 —
  // 한 사업장만 떼어 보면 같은 고객사의 다른 사업장에서 벌어진 일이 보이지 않고,
  // 같은 타임라인을 두 곳에서 따로 고쳐야 했다. 여기는 장비만 남는다.
  /** 요약의 「장비」 숫자를 누르면 이 카드로 내려간다(전에는 탭을 바꿨다). */
  const deviceCardRef = useRef<HTMLDivElement | null>(null)
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

    /* 2단 레이아웃 — 좌(업체·담당자·요약) / 우(활동 이력·장비 탭).
       왼쪽은 폭이 고정이고 오른쪽이 남는 공간을 전부 갖는다(화면이 넓을수록 장비가 더 보인다).
       왼쪽만 sticky 로 붙여두고 페이지 스크롤 시 오른쪽이 흐른다.
       오른쪽 상한 1600px — 그 이상은 장비 카드(300px)가 다섯 장을 넘어 한눈에 안 들어오고,
       초광폭에서 카드 하나가 화면을 가로지르게 되므로 거기서 멈추고 판 전체를 가운데 정렬한다. */
    .cust-grid {
      display: grid;
      grid-template-columns: 340px minmax(0, 1600px);
      grid-template-areas: "left center";
      gap: 16px;
      align-items: start;
      justify-content: center;
    }
    .cust-left { grid-area: left; display: flex; flex-direction: column; gap: 12px; }
    /* 카드 사이 간격은 이 열의 gap(12) 하나로만 정한다.
       카드 컴포넌트가 제 아래 여백을 들고 있으면(업체 정보 카드의 marginBottom: 16) 그 카드 밑만
       28px 이 되어 줄이 어긋난다. 인라인 style 이라 !important 가 있어야 덮인다.

       flex-shrink: 0 — **카드는 줄어들지 않는다. 넘치면 이 열이 스크롤한다.**
       이 열은 세로 flex 에 max-height 가 걸려 있어(아래 sticky), 카드 높이의 합이 그 선을
       넘으면 flex 가 카드를 눌러 줄인다. 보통은 「자동 최소 크기」가 내용 높이 밑으로는
       못 줄이게 막아 주는데, 그 보호는 **overflow 가 visible 인 항목에만** 적용된다.
       담당자 카드는 둥근 모서리 때문에 overflow: hidden 이라(ContactSection) 최소 높이가
       0 으로 풀려 눌렸고, 넘침을 숨기는 쪽이라 스크롤도 못 하고 **그냥 잘렸다** —
       담당자를 펼치면 세 번째 사람 이름이 반쯤 잘렸고, 창이 낮으면 접은 상태에서도 잘렸다.
       (측정 2026-10-28, 1500×700: 펼침 265 → 219px · 1500×560: 접음 203 → 79px) */
    .cust-left > * { margin-bottom: 0 !important; flex-shrink: 0; }
    .cust-center { grid-area: center; min-width: 0; }
    .cust-left {
      position: sticky;
      /* 헤더가 없어져 본문 위쪽 여백(20)만 비우면 된다 */
      top: 20px;
      max-height: calc(100vh - 40px);
      overflow-y: auto;
    }
    /* 본문이 900px 밑으로 좁아지면 1단으로 내린다(왼쪽 카드 → 활동 이력 순서).
       사이드바가 232px 를 가져가므로 화면 기준으로는 900 + 232 = 1132px 이 경계다.
       768px 이하에서는 사이드바가 숨어 본문이 화면 폭 그대로지만, 그 폭은 이미 900 미만이라
       같은 규칙에 걸린다. */
    @media (max-width: 1131px) {
      .cust-grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: "left" "center";
      }
      .cust-left {
        position: static;
        max-height: none;
        overflow-y: visible;
      }
    }
    /* 분할 보기(칸 안)에서는 **칸 폭**을 기준으로 접는다 — 화면 폭으로 접으면 1366 에서도
       오른쪽 칸은 600px 남짓인데 2단을 고집해 글이 눌린다. 컨테이너 쿼리라 칸이 좁아지면
       한 단으로 내려간다. 라우트에서는 이 클래스가 붙지 않아 영향이 없다. */
    .cust-embed { container-type: inline-size; }
    /* 칸 안에서는 왼쪽 열을 300px 로 조인다 — 1366 화면에서 이 칸은 722px 남짓이라
       340 을 고집하면 오른쪽 타임라인이 눌린다(실측 2026-11-19). */
    .cust-embed .cust-grid { grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 12px; }
    .cust-embed .cust-left { position: static; max-height: none; overflow-y: visible; }
    /* 700px — 1366 화면의 오른쪽 칸(722px)은 2단을 지킨다. 그보다 좁아지면(사이드바를
       펼친 1280 이하 등) 한 단으로 내려 글이 눌리지 않게 한다. */
    @container (max-width: 700px) {
      .cust-grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: "left" "center";
      }
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
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>
                사업장을 묶는 회사입니다.
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: R.control, padding: '14px 16px', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>사업장</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '2px 8px' }}>
                  {childSites.length}곳
                </span>
              </div>
              {childSites.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
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
                      <span style={{ color: '#9ca3af', flexShrink: 0 }}>→</span>
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

        {/* 경로 줄(「고객사 / 회사명」)은 걷었다 — 회사명은 바로 아래 정보 카드의 제목이고,
            목록으로 가는 길은 그 제목 앞 화살표가 맡는다(의뢰서 상세와 같은 방식).
            48px 한 줄을 돌려받아 본문이 그만큼 위로 올라온다. */}
        <div className="cust-grid">

          {/* ── 좌: 업체 정보 · 담당자 · 요약 ── */}
          <div className="cust-left">
            <CustomerInfoPanel
              customer={customer}
              companyName={family?.name ?? null}
              onEdit={() => customerCrud.setIsEditCustomerModalOpen(true)}
              onBack={onBack}
              /* 회사명을 누르는 것과 ← 는 같은 곳으로 간다(분할 보기의 회사 화면).
                 둘 다 두는 까닭: ← 는 「돌아가기」, 회사명은 「이 사업장이 어느 회사인가」다. */
              onOpenCompany={embedded ? onBack : undefined}
            />

            <ContactSection
              contacts={contacts}
              onAdd={() => contact.setIsAddContactModalOpen(true)}
              onEdit={contact.setSelectedContact}
            />
          </div>

          {/* ── 우: 장비 ── */}
          <div className="cust-center" ref={deviceCardRef}>

        {/* 가운데 열 — **장비**. 활동은 회사 화면의 전체 타임라인이 맡는다. */}
        <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: R.card, overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', borderBottom: '1px solid #ebebeb', display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ ...TITLE }}>장비</b>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: R.pill, padding: '1px 7px' }}>{activeDevices.length}</span>
            <span style={{ flex: 1 }} />
            {/* 더하는 자리는 머리줄의 + 하나다 — 아래 점선 카드와 같은 일을 한다(둘 다 둔다:
                장비가 많으면 맨 아래 점선 카드까지 가지 않고 여기서 누른다). */}
            <AddIconButton label="장비 추가" onClick={() => device.setIsAddDeviceModalOpen(true)} />
          </div>

        <div style={{ padding: '12px 14px' }}>
        <DeviceSection
          devices={devices}
          companyName={customer?.company_name ?? null}
          historyByDevice={historyByDevice}
          onAddDevice={() => device.setIsAddDeviceModalOpen(true)}
          onEditDevice={device.setSelectedDevice}
          onAddService={service.setSelectedDeviceId}
          onEditService={service.setSelectedService}
          onImageUpload={device.setSelectedImageDevice}
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
        />
        </div>

        </div>
          </div>
        </div>

        {/* ── 모달 ── */}
        <CustomerEditModal
          customer={customerCrud.isEditCustomerModalOpen ? customer : null}
          isSaving={customerCrud.isSavingCustomerEdit}
          isDeleting={customerCrud.isDeletingCustomer}
          onClose={() => customerCrud.setIsEditCustomerModalOpen(false)}
          onSave={customerCrud.handleUpdateCustomer}
          onDelete={isSuperAdmin({ permission_level: currentUserRole }) ? customerCrud.handleDeleteCustomer : undefined}
        />
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
          onDelete={contact.handleDeleteContact}
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
          onDelete={device.handleDeleteDevice}
          onDispose={device.handleDisposeDevice}
          onRestore={device.handleRestoreDevice}
          onOpenPacking={() => device.selectedDevice && device.handleOpenPacking(device.selectedDevice)}
          onImageChanged={fetchDetail}
        />
        <ServiceAddModal
          deviceId={service.selectedDeviceId}
          contacts={contacts}
          engineers={engineers}
          currentUserEngineerId={currentUserEngineerId}
          isSaving={service.isSavingService}
          onClose={() => service.setSelectedDeviceId(null)}
          onSave={service.handleAddService}
        />
        <ServiceEditModal
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
        <DeviceImageModal
          device={device.selectedImageDevice}
          isSaving={device.isSavingDeviceImage}
          onClose={() => device.setSelectedImageDevice(null)}
          onSave={device.handleUploadDeviceImage}
        />

      </div>
    </>
  )
}
