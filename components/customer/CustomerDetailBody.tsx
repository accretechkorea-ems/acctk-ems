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

import { useRef, useState, useCallback } from 'react'

import { useCustomerDetail } from '@/hooks/customer/useCustomerDetail'
import { useServiceCrud } from '@/hooks/customer/useServiceCrud'
import { useContactCrud } from '@/hooks/customer/useContactCrud'
import { useDeviceCrud } from '@/hooks/customer/useDeviceCrud'
import { useCustomerCrud } from '@/hooks/customer/useCustomerCrud'
import { useHoldingCrud } from '@/hooks/customer/useHoldingCrud'
import { isSuperAdmin } from '@/lib/permissions'

import type { Device, ServiceHistory } from '@/components/customer/types'
import { PAGE_BG, TEXT_MUTED } from '@/components/customer/constants'

import SiteHeaderBand from '@/components/customer/SiteHeaderBand'
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
import DeviceImageModal from '@/components/customer/modals/DeviceImageModal'
import { R } from '@/lib/radius'

export type CustomerDetailBodyProps = {
  customerId: number
  /** 제목 앞 화살표 — 라우트는 목록으로 가고, 분할 보기는 회사 보기로 돌아간다. */
  onBack?: () => void
  /** 이 화면에서 무언가 고쳤다 — 바깥 화면(목록 보기)이 자기 자료를 다시 읽게 한다. */
  onChanged?: () => void
  /** 칸 안에 끼워 그릴 때(분할 보기). 바깥 여백과 접히는 기준만 달라진다. */
  embedded?: boolean
}

export default function CustomerDetailBody({
  customerId, onBack, onChanged, embedded = false,
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
  /**
   * 폐기 장비도 볼까 — 스위치는 **사업장 수정 모달 안의 체크**다(2026-11-20).
   * 값은 이 화면이 들고 있어, 모달을 닫아도 보던 대로 남는다.
   */
  const [showDisposed, setShowDisposed] = useState(false)
  const disposedCount = devices.length - inUseOnly(devices).length

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
  const contact = useContactCrud({ customerId, fetchDetail: refreshAll })
  const device = useDeviceCrud({ customerId, fetchDetail: refreshAll })
  const customerCrud = useCustomerCrud({ customer, fetchDetail: refreshAll })

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

    /* 한 단이다 — 맨 위 가로 띠(업체·장비 수·담당자) 아래를 장비가 전부 쓴다.
       전에는 왼쪽 300~340px 열에 업체·담당자 카드를 세로로 쌓았는데, 그 열이 가져간
       자리만큼 장비 카드가 좁아 1366 에서 두 대만 보였다(2026-11-20 실측). */
    .site-wrap { display: flex; flex-direction: column; gap: 12px; max-width: 1920px; margin: 0 auto; }
    .cust-center { min-width: 0; }

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

        {/* 맨 위 가로 띠 — 업체 · 장비 수 · 담당자. 그 아래를 장비가 전부 쓴다.
            세로 카드 둘을 왼쪽에 쌓던 때는 그 열이 가져간 300px 만큼 장비가 좁았다. */}
        <div className="site-wrap">
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

          {/* 장비 — 머리줄을 두지 않는다. 장비 수는 띠에 있고, 더하는 자리는 그리드 끝 점선 카드다. */}
          <div className="cust-center" ref={deviceCardRef}>
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
          showDisposed={showDisposed}
        />
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
          onDelete={isSuperAdmin({ permission_level: currentUserRole }) ? customerCrud.openDeleteCustomer : undefined}
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
          onDelete={isSuperAdmin({ permission_level: currentUserRole }) ? contact.openDeleteContact : undefined}
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
          onDelete={isSuperAdmin({ permission_level: currentUserRole }) ? device.openDeleteDevice : undefined}
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
