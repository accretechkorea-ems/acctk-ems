'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Font } from '@react-pdf/renderer'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { canViewCustomers, isSuperAdmin } from '@/lib/permissions'
import { isMobileViewport } from '@/lib/viewport'

import { useCustomerDetail } from '@/hooks/customer/useCustomerDetail'
import { useServiceCrud } from '@/hooks/customer/useServiceCrud'
import { useContactCrud } from '@/hooks/customer/useContactCrud'
import { useDeviceCrud } from '@/hooks/customer/useDeviceCrud'
import { useCustomerCrud } from '@/hooks/customer/useCustomerCrud'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import { useSalesActivityCrud } from '@/hooks/customer/useSalesActivityCrud'
import { useOpportunityCrud } from '@/hooks/customer/useOpportunityCrud'
import { useHoldingCrud } from '@/hooks/customer/useHoldingCrud'

import type { Device, ServiceHistory } from '@/components/customer/types'
import { PAGE_BG, TEXT_MUTED } from '@/components/customer/constants'

import SegmentedControl from '@/components/common/SegmentedControl'
import HorizontalScroller from '@/components/common/HorizontalScroller'
import CustomerInfoPanel from '@/components/customer/CustomerInfoPanel'
import ContactSection from '@/components/customer/ContactSection'
import DeviceSection from '@/components/customer/DeviceSection'
import ActivityTimeline from '@/components/customer/ActivityTimeline'
import SummaryPanel from '@/components/customer/SummaryPanel'
import SalesActivityModal from '@/components/customer/modals/SalesActivityModal'
import OpportunityModal from '@/components/customer/modals/OpportunityModal'
import HoldingModal from '@/components/customer/modals/HoldingModal'
import HoldingResolveModal from '@/components/customer/modals/HoldingResolveModal'
import QuoteHistoryModal from '@/components/customer/modals/QuoteHistoryModal'
import CustomerEditModal from '@/components/customer/modals/CustomerEditModal'
import ContactAddModal from '@/components/customer/modals/ContactAddModal'
import ContactEditModal from '@/components/customer/modals/ContactEditModal'
import DeviceAddModal from '@/components/customer/modals/DeviceAddModal'
import DeviceEditModal from '@/components/customer/modals/DeviceEditModal'
import ServiceAddModal from '@/components/customer/modals/ServiceAddModal'
import ServiceEditModal from '@/components/customer/modals/ServiceEditModal'
import SignModal from '@/components/customer/modals/SignModal'
import DeviceImageModal from '@/components/customer/modals/DeviceImageModal'

Font.register({
  family: 'NotoSansCJK',
  src: 'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4hfeE.ttf',
})

export default function CustomerDetailPage() {
  const { loading: guardLoading, authorized } = usePageGuard(canViewCustomers)
  const params = useParams()
  const customerId = Number(params.id)

  const detail = useCustomerDetail(customerId)
  const {
    customer, devices, contacts, history, quotes, activities, opportunities, engineers,
    family, childSites,
    holdings, activeHoldingByDevice, holdingByService,
    loading, currentUserEngineerId, currentUserRole,
    historyByDevice, fetchDetail,
  } = detail

  const holding = useHoldingCrud({ customerId, holdings, engineerId: currentUserEngineerId, fetchDetail, activeHoldingByDevice, role: currentUserRole })
  const service = useServiceCrud({
    customerId, customer, contacts, engineers, fetchDetail,
    onActiveHoldingFound: h => holding.openResolve(h, '이 장비에 홀딩 중인 건이 있습니다. 해제할까요?'),
  })
  const contact = useContactCrud({ customerId, fetchDetail })
  const device = useDeviceCrud({ customerId, fetchDetail })
  const customerCrud = useCustomerCrud({ customer, fetchDetail })
  const quotePdf = useQuotePdf({ customer, engineerId: currentUserEngineerId })
  const activity = useSalesActivityCrud({ customerId, engineerId: currentUserEngineerId, role: currentUserRole, fetchDetail })
  const opp = useOpportunityCrud({ customerId, engineerId: currentUserEngineerId, role: currentUserRole, fetchDetail })

  // ── 이 화면에서만 쓰는 상태 ──
  // 모바일(현장)에서는 장비를 먼저 본다. 데스크톱은 기존대로 활동 이력.
  // 첫 렌더는 서버에서도 도는데 그때는 false(데스크톱)라, 화면에 나오는 것은
  // 어차피 로딩 스켈레톤이므로 hydration 이 어긋나지 않는다.
  const [tab, setTab] = useState<'활동 이력' | '장비'>(() => (isMobileViewport() ? '장비' : '활동 이력'))
  // 거래 이력은 두 기준으로 열린다 — 이 사업장만(site), 같은 회사 전체(family).
  const [quoteScope, setQuoteScope] = useState<'site' | 'family' | null>(null)
  const [isSignModalOpen, setIsSignModalOpen] = useState(false)
  const [pendingReportService, setPendingReportService] = useState<ServiceHistory | null>(null)
  const [pendingReportDevice, setPendingReportDevice] = useState<Device | null>(null)

  const globalCss = `
    html, body { background: ${PAGE_BG}; }
    input::placeholder, textarea::placeholder { color: ${TEXT_MUTED}; opacity: 1; }
    select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }
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

    /* 3단 레이아웃 — 좌(업체·담당자) / 중앙(탭) / 우(요약).
       좌우는 폭이 고정이고 가운데가 남는 공간을 전부 갖는다(화면이 넓을수록 장비가 더 보인다).
       좌우는 sticky 로 붙여두고 페이지 스크롤 시 가운데만 흐르게 한다.
       가운데 상한 1600px — 그 이상은 장비 카드(300px)가 다섯 장을 넘어 한눈에 안 들어오고,
       초광폭에서 카드 하나가 화면을 가로지르게 되므로 거기서 멈추고 판 전체를 가운데 정렬한다. */
    .cust-grid {
      display: grid;
      grid-template-columns: 320px minmax(0, 1600px) 280px;
      grid-template-areas: "left center right";
      gap: 16px;
      align-items: start;
      justify-content: center;
    }
    .cust-left { grid-area: left; }
    .cust-center { grid-area: center; min-width: 0; }
    .cust-right { grid-area: right; }
    .cust-left, .cust-right {
      position: sticky;
      top: 20px;
      max-height: calc(100vh - 40px);
      overflow-y: auto;
    }
    /* 1180px 미만: 우측 요약을 좌측 열 아래로 내린다.
       (좌 320 + 우 280 + gap 32 + 좌우 여백 48 = 680 이 고정이라,
        이 아래로 내려가면 가운데가 500px 밑으로 좁아진다) */
    @media (max-width: 1179px) {
      .cust-grid {
        grid-template-columns: 300px minmax(0, 1fr);
        grid-template-areas: "left center" "right center";
        align-content: start;
      }
      .cust-right { position: static; max-height: none; overflow-y: visible; }
      .cust-left { max-height: calc(100vh - 160px); }
    }
    /* 900px 미만: 1단 — 좌측(300)까지 빼고 나면 가운데가 읽을 만한 폭이 안 나온다 */
    @media (max-width: 899px) {
      .cust-grid {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: "left" "center" "right";
      }
      .cust-left, .cust-right {
        position: static;
        max-height: none;
        overflow-y: visible;
      }
    }
  `

  if (!authorized) return <AccessGate loading={guardLoading} />

  if (loading) {
    return (
      <>
        <style jsx global>{globalCss}</style>
        <main style={{ padding: '20px 24px', background: PAGE_BG, minHeight: '100vh' }}>
          {[{ h: 130, mb: 24 }, { h: 120, mb: 24 }, { h: 400, mb: 0 }].map(({ h, mb }, i) => (
            <div key={i} style={{
              background: '#ffffff', borderRadius: 20, height: h, marginBottom: mb,
              border: '1px solid #e5e7eb',
              animation: 'sk-pulse 1.6s ease-in-out infinite',
              animationDelay: `${i * 0.15}s`,
            }} />
          ))}
        </main>
      </>
    )
  }

  // 부모 행은 사업장을 묶기만 하는 껍데기다(주소·장비·견적이 없다).
  // 일반 상세를 그대로 보여주면 빈 화면이 되므로, 무엇인지 알려주고 소속 사업장만 낸다.
  if (customer?.is_parent) {
    return (
      <>
        <style jsx global>{globalCss}</style>
        <main style={{ padding: '20px 24px', background: PAGE_BG, minHeight: '100vh' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', letterSpacing: '-0.3px', marginBottom: 6 }}>
                {customer.company_name}
              </div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>
                이 업체는 사업장을 묶는 상위 항목입니다.
              </div>
            </div>

            <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, padding: '14px 16px', marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>소속 사업장</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', borderRadius: 99, padding: '2px 8px' }}>
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
        </main>
      </>
    )
  }

  return (
    <>
      <style jsx global>{globalCss}</style>

      <main style={{ padding: '20px 24px', background: PAGE_BG, minHeight: '100vh' }}>

        <div className="cust-grid">

          {/* ── 좌: 업체 정보 · 담당자 ── */}
          <div className="cust-left">
            <CustomerInfoPanel
              customer={customer}
              onEdit={() => customerCrud.setIsEditCustomerModalOpen(true)}
            />

            <ContactSection
              contacts={contacts}
              onAdd={() => contact.setIsAddContactModalOpen(true)}
              onEdit={contact.setSelectedContact}
            />
          </div>

          {/* ── 우: 요약 ── */}
          <div className="cust-right">
            <SummaryPanel
              quotes={quotes}
              deviceCount={devices.length}
              history={history}
              customerId={customerId}
              opportunities={opportunities}
              onAddOpportunity={opp.openNewOpp}
              onOpenOpportunity={opp.openEditOpp}
              onChangeStage={opp.changeStage}
              canEditOpportunity={opp.canEditOpp}
              holdings={holdings}
              onOpenHolding={holding.openHolding}
              onQuoteHistoryOpen={() => setQuoteScope('site')}
              family={family ? { name: family.name, siteCount: family.siteCount, quoteCount: family.quotes.length } : null}
              onFamilyQuoteHistoryOpen={() => setQuoteScope('family')}
            />
          </div>

          {/* ── 중앙: 탭 ── */}
          <div className="cust-center">

        {/* 활동 이력 · 장비 탭 — 같은 서비스 기록이 양쪽에 보이는 것은 의도된 동작이다
            (장비 탭은 장비별로, 활동 이력 탭은 시간순으로 본다) */}
        {/* 가운데 열은 카드 하나. 탭이 그 카드의 헤더가 되어 좌·우 열의 카드와 같은 y 에서 시작한다.
            건수는 탭 라벨에 붙인다 — 탭 아래에 제목을 또 두면 탭 이름과 중복이다.
            활동 이력은 타임라인이 필터별 건수를 보여주므로 라벨에 넣지 않는다. */}
        <div style={{ background: '#ffffff', border: '1px solid #ebebeb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', borderBottom: '1px solid #ebebeb', display: 'flex', justifyContent: 'center' }}>
            <SegmentedControl
              options={['활동 이력', { label: '장비', value: '장비', suffix: String(devices.length) }]}
              value={tab}
              onChange={v => setTab(v as '활동 이력' | '장비')}
            />
          </div>

        {tab === '활동 이력' && (
          // 장비 탭과 달리 여기는 글줄이라, 카드가 넓어져도 한 줄이 끝없이 길어지지 않게 폭을 제한한다.
          // (탭이 카드 가운데에 있으므로 본문도 가운데 정렬)
          <div style={{ padding: '12px 14px', maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            <ActivityTimeline
              history={history}
              devices={devices}
              quotes={quotes}
              activities={activities}
              holdings={holdings}
              customerId={customerId}
              onOpenQuotePdf={quotePdf.openQuotePdf}
              onOpenHolding={holding.openHolding}
              onAddActivity={activity.openNewActivity}
              onEditActivity={activity.openEditActivity}
              canEditActivity={activity.canEditActivity}
            />
          </div>
        )}

        {tab === '장비' && (
        <div style={{ padding: '12px 14px' }}>
        <HorizontalScroller>
        <DeviceSection
          devices={devices}
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
          onUploadPacking={device.handleUploadPacking}
          onOpenPacking={device.handleOpenPacking}
          activeHoldingByDevice={activeHoldingByDevice}
          holdingByService={holdingByService}
          onAddHolding={holding.openNewHolding}
          onOpenHolding={holding.openHolding}
        />
        </HorizontalScroller>
        </div>
        )}

        </div>
          </div>
        </div>

        {/* ── 모달 ── */}
        <QuoteHistoryModal
          isOpen={quoteScope !== null}
          customer={customer}
          quotes={quoteScope === 'family' && family ? family.quotes : quotes}
          family={quoteScope === 'family' && family ? { name: family.name, siteCount: family.siteCount } : null}
          onClose={() => setQuoteScope(null)}
        />
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
          onOpenPacking={() => device.selectedDevice && device.handleOpenPacking(device.selectedDevice)}
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
        <SalesActivityModal
          isOpen={activity.isActivityModalOpen}
          activity={activity.editingActivity}
          contacts={contacts}
          opportunities={opportunities}
          isSaving={activity.isSavingActivity}
          canDelete={!!activity.editingActivity && activity.canEditActivity(activity.editingActivity)}
          onClose={activity.closeActivityModal}
          onSave={activity.handleSaveActivity}
          onDelete={activity.handleDeleteActivity}
        />
        <OpportunityModal
          isOpen={opp.isOppModalOpen}
          opportunity={opp.editingOpp}
          activities={activities}
          customers={[]}
          lockedCustomerName={customer?.company_name ?? null}
          engineers={engineers}
          isSaving={opp.isSavingOpp}
          canEdit={!opp.editingOpp || opp.canEditOpp(opp.editingOpp)}
          currentUserEngineerId={currentUserEngineerId}
          canPickEngineer={isSuperAdmin({ permission_level: currentUserRole })}
          onClose={opp.closeOppModal}
          onSave={opp.handleSaveOpp}
          onDelete={opp.handleDeleteOpp}
          onOpenQuotePdf={quotePdf.openQuotePdfByUrl}
          onSetClosed={opp.setClosed}
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

      </main>
    </>
  )
}
