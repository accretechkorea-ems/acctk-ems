'use client'

import { useRef, useState } from 'react'
import type { Device, ServiceHistory } from './types'
import { INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WHITE_BUTTON_BG, WHITE_BUTTON_TEXT } from './constants'
import { getInstallDisplay, getDefaultImageUrl } from './utils'
import { SERVICE_TYPE_COLORS, getCategoryColor } from '@/lib/categoryColors'

type Props = {
  devices: Device[]
  historyByDevice: Map<number, ServiceHistory[]>
  onAddDevice: () => void
  onEditDevice: (device: Device) => void
  onAddService: (deviceId: number) => void
  onEditService: (service: ServiceHistory) => void
  onImageUpload: (device: Device) => void
  onPrintReport: (service: ServiceHistory, device: Device) => void
  onOpenReport: (service: ServiceHistory) => void
  onUploadPacking: (device: Device, file: File) => void
  onOpenPacking: (device: Device) => void
}

function ServiceCard({ h, d, onEdit, onPrint, onOpenReport }: { h: ServiceHistory; d: Device; onEdit: () => void; onPrint: () => void; onOpenReport: () => void }) {
  const [hovered, setHovered] = useState(false)
  const typeColor = getCategoryColor(SERVICE_TYPE_COLORS, h.service_type).text

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', background: hovered ? '#fafbfc' : '#f8f9fb', borderRadius: 12,
        border: `1px solid ${hovered ? '#dce1ea' : INPUT_BORDER}`,
        boxSizing: 'border-box', overflow: 'hidden',
        display: 'flex', transition: 'border-color 0.15s ease, background 0.15s ease',
      }}
    >
      {/* 타입 컬러 바 */}
      <div style={{ width: 3, flexShrink: 0, background: typeColor }} />

      <div style={{ flex: 1, padding: '11px 13px' }}>
        {/* 헤더: 타입 + 배지 + 버튼들 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: typeColor }}>
              {h.service_type ?? '-'}
            </span>
            {h.is_paid !== null && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                background: h.is_paid ? '#eff4ff' : '#f0fdf4',
                color: h.is_paid ? '#234ea2' : '#16a34a',
              }}>
                {h.is_paid ? '유상' : '무상'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              onClick={onEdit}
              style={{
                padding: '4px 9px', background: '#f4f5f7', color: TEXT_SECONDARY,
                borderRadius: 7, border: `1px solid ${INPUT_BORDER}`,
                cursor: 'pointer', fontWeight: 600, fontSize: 11,
                transition: 'all 0.15s ease',
              }}
            >
              수정
            </button>
            {h.report_url ? (
              <button
                onClick={onOpenReport}
                style={{
                  padding: '4px 9px', background: '#f0fdf4', color: '#16a34a',
                  borderRadius: 7, border: '1px solid #bbf7d0',
                  cursor: 'pointer', fontWeight: 700, fontSize: 11,
                  transition: 'all 0.15s ease',
                }}
              >
                레포트 열기
              </button>
            ) : (
              <button
                onClick={onPrint}
                style={{
                  padding: '4px 9px', background: '#f4f5f7', color: TEXT_SECONDARY,
                  borderRadius: 7, border: `1px solid ${INPUT_BORDER}`,
                  cursor: 'pointer', fontWeight: 600, fontSize: 11,
                  transition: 'all 0.15s ease',
                }}
              >
                레포트 작성
              </button>
            )}
          </div>
        </div>

        {/* 서비스 노트 */}
        <div style={{
          fontSize: 13, color: TEXT_PRIMARY, whiteSpace: 'pre-wrap',
          wordBreak: 'break-word', lineHeight: 1.55, marginBottom: 10,
        }}>
          {h.service_notes ?? '-'}
        </div>

        {/* 메타 정보 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: TEXT_MUTED }}>
          <span>{h.visit_date ?? '-'}</span>
          <span style={{ textAlign: 'right' }}>
            {h.service_engineers && h.service_engineers.length > 0
              ? h.service_engineers.map(se => `${se.engineers.name} ${se.engineers.position ?? ''}`.trim()).join(', ')
              : (h.visitor ?? '-')}
          </span>
        </div>
      </div>
    </div>
  )
}

function DeviceCard({ d, deviceHistory, onEditDevice, onAddService, onEditService, onImageUpload, onPrintReport, onOpenReport, onUploadPacking, onOpenPacking, supabaseUrl }: {
  d: Device
  deviceHistory: ServiceHistory[]
  onEditDevice: () => void
  onAddService: () => void
  onEditService: (s: ServiceHistory) => void
  onImageUpload: () => void
  onPrintReport: (s: ServiceHistory) => void
  onOpenReport: (s: ServiceHistory) => void
  onUploadPacking: (file: File) => void
  onOpenPacking: () => void
  supabaseUrl: string
}) {
  const deviceTitle = `${d.device_name ?? ''} ${d.device_name2 ?? ''} ${d.option ?? ''}`.replace(/\s+/g, ' ').trim()
  const defaultImg = getDefaultImageUrl(d, supabaseUrl)
  const packingInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div style={{
      minWidth: 300, maxWidth: 300, background: '#ffffff', borderRadius: 18, padding: 16,
      border: `1px solid ${INPUT_BORDER}`, flex: '0 0 auto', position: 'relative',
      alignSelf: 'flex-start', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
    }}>
      {/* 수정 버튼 */}
      <button
        onClick={onEditDevice}
        style={{
          position: 'absolute', top: 12, right: 12, zIndex: 2,
          width: 28, height: 28, borderRadius: '50%',
          background: '#f4f5f7', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: TEXT_MUTED,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>

      {/* 이미지 영역 */}
      <div style={{
        height: 170, borderRadius: 12, background: '#f4f5f7',
        marginBottom: 14, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {d.image_url ? (
          <img src={d.image_url} alt={deviceTitle || 'device'} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
        ) : defaultImg ? (
          <img src={defaultImg} alt={deviceTitle || 'device'} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
        ) : (
          <button
            onClick={onImageUpload}
            style={{
              width: '100%', height: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: '#e8edf8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={WHITE_BUTTON_BG} strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <span style={{ fontSize: 11, color: TEXT_MUTED, fontWeight: 600 }}>사진 등록</span>
          </button>
        )}
      </div>

      {/* 장비명 */}
      <div style={{
        fontSize: 15, fontWeight: 800, color: TEXT_PRIMARY, textAlign: 'center',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        marginBottom: 8, padding: '0 4px',
      }} title={deviceTitle || '-'}>
        {deviceTitle || '-'}
      </div>

      {/* 스펙 정보 */}
      <div style={{ fontSize: 12, color: TEXT_SECONDARY, textAlign: 'center', marginBottom: 3 }}>
        S/N: {d.serial_number ?? '-'} &nbsp;|&nbsp; {d.program ?? '-'}
      </div>
      <div style={{ fontSize: 12, color: TEXT_MUTED, textAlign: 'center', marginBottom: 8 }}>
        납입: {getInstallDisplay(d)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
        {d.packing_list_url ? (
          <button
            onClick={onOpenPacking}
            style={{
              fontSize: 11, fontWeight: 700, color: WHITE_BUTTON_BG,
              background: '#eff4ff', border: '1px solid #cfe0ff', borderRadius: 7,
              padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            납입의사록•패킹리스트
          </button>
        ) : (
          <>
            <input
              ref={packingInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUploadPacking(f)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => packingInputRef.current?.click()}
              style={{
                fontSize: 11, fontWeight: 600, color: TEXT_MUTED,
                background: '#f4f5f7', border: `1px solid ${INPUT_BORDER}`, borderRadius: 7,
                padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              납입의사록•패킹리스트 업로드
            </button>
          </>
        )}
      </div>

      {/* 서비스 추가 버튼 */}
      <button
        onClick={onAddService}
        style={{
          width: '100%', padding: '9px 14px', background: WHITE_BUTTON_BG, color: WHITE_BUTTON_TEXT,
          borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, marginBottom: 12,
        }}
      >
        서비스 레포트 추가
      </button>

      {/* 서비스 히스토리 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {deviceHistory.length === 0 ? (
          <div style={{
            background: '#f8f9fb', borderRadius: 10, padding: '14px 13px',
            border: `1px solid ${INPUT_BORDER}`, textAlign: 'center',
          }}>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>서비스 기록 없음</div>
          </div>
        ) : deviceHistory.map((h) => (
          <ServiceCard
            key={`${d.device_id}-${h.service_id}`}
            h={h}
            d={d}
            onEdit={() => onEditService(h)}
            onPrint={() => onPrintReport(h)}
            onOpenReport={() => onOpenReport(h)}
          />
        ))}
      </div>
    </div>
  )
}

export default function DeviceSection({ devices, historyByDevice, onAddDevice, onEditDevice, onAddService, onEditService, onImageUpload, onPrintReport, onOpenReport, onUploadPacking, onOpenPacking }: Props) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  return (
    <div style={{ marginBottom: 28 }}>
      {/* 섹션 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY }}>장비</h2>
        {devices.length > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
            background: '#eff4ff', color: WHITE_BUTTON_BG,
          }}>
            {devices.length}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 4, alignItems: 'flex-start' }}>
        {devices.map((d) => (
          <DeviceCard
            key={d.device_id}
            d={d}
            deviceHistory={historyByDevice.get(d.device_id) || []}
            onEditDevice={() => onEditDevice(d)}
            onAddService={() => onAddService(d.device_id)}
            onEditService={onEditService}
            onImageUpload={() => onImageUpload(d)}
            onPrintReport={(s) => onPrintReport(s, d)}
            onOpenReport={(s) => onOpenReport(s)}
            onUploadPacking={(file) => onUploadPacking(d, file)}
            onOpenPacking={() => onOpenPacking(d)}
            supabaseUrl={supabaseUrl}
          />
        ))}

        {/* 장비 추가 버튼 */}
        <button
          onClick={onAddDevice}
          style={{
            minWidth: 300, minHeight: 460, flex: '0 0 auto',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: '#ffffff', border: `2px dashed ${INPUT_BORDER}`, borderRadius: 18,
            cursor: 'pointer', color: TEXT_MUTED, fontSize: 13, fontWeight: 600,
            transition: 'all 0.15s ease', alignSelf: 'flex-start',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#234ea2'
            e.currentTarget.style.color = '#234ea2'
            e.currentTarget.style.background = '#f8faff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = INPUT_BORDER
            e.currentTarget.style.color = TEXT_MUTED
            e.currentTarget.style.background = '#ffffff'
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: '50%', background: '#f4f5f7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, lineHeight: 1,
          }}>+</div>
          장비 추가
        </button>
      </div>
    </div>
  )
}
