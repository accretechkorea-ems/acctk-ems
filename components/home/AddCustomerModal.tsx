'use client'

import {
  CARD_BG,
  INPUT_BORDER,
  PANEL_BG,
  TEXT_PRIMARY,
  WHITE_BUTTON_BG,
  WHITE_BUTTON_TEXT,
  inputStyle,
  dateInputStyle,
  sectionCardStyle,
  type Contact,
  type NewDeviceForm,
} from '@/lib/home'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useEffect } from 'react'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'

type CustomerForm = {
  company_name: string
  address: string
  agency: string
  status: string
}

// 검증 에러 key: 스칼라 3종 + 장비 항목별(device_0, device_1 …) — 인덱스는 템플릿 리터럴로 타입 안전
type ErrKey = 'company_name' | 'address' | 'contact_name' | `device_${number}`

type Props = {
  isOpen: boolean
  isSavingCustomer: boolean
  customerForm: CustomerForm
  setCustomerForm: React.Dispatch<React.SetStateAction<CustomerForm>>
  contactForm: Contact
  setContactForm: React.Dispatch<React.SetStateAction<Contact>>
  deviceForms: NewDeviceForm[]
  updateDeviceForm: (
    index: number,
    field: keyof NewDeviceForm,
    value: string | File | null
  ) => void
  addDeviceFormCard: () => void
  removeDeviceFormCard: (index: number) => void
  onClose: () => void
  onSave: () => void
}

export default function AddCustomerModal({
  isOpen,
  isSavingCustomer,
  customerForm,
  setCustomerForm,
  contactForm,
  setContactForm,
  deviceForms,
  updateDeviceForm,
  addDeviceFormCard,
  removeDeviceFormCard,
  onClose,
  onSave,
}: Props) {
  const { errors, setErrors, clearError, validate } = useFieldErrors<ErrKey>()
  // 모달 열림/닫힘(gate=isOpen) 시 에러 초기화
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setErrors({}) }, [isOpen])

  if (!isOpen) return null

  // 장비 카드 삭제 시 인덱스가 밀리므로 device_* 에러는 전부 정리 (스칼라 에러는 유지)
  const clearDeviceErrors = () => setErrors(prev =>
    Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith('device_'))) as Partial<Record<ErrKey, string>>
  )

  // 사용자 검증은 여기(모달)에서 인라인으로 한꺼번에 수집. 통과해야만 onSave() → addCustomer 호출.
  const handleSave = () => {
    const rules: Partial<Record<ErrKey, string | null>> = {
      company_name: customerForm.company_name.trim() ? null : '업체명을 입력해주세요',
      address: customerForm.address.trim() ? null : '주소를 입력해주세요',
      contact_name: contactForm.name.trim() ? null : '담당자 이름을 입력해주세요',
    }
    deviceForms.forEach((d, i) => { rules[`device_${i}`] = d.device_name.trim() ? null : '장비 라인업을 입력해주세요' })
    if (!validate(rules)) return
    onSave()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 780,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: CARD_BG,
          color: TEXT_PRIMARY,
          borderRadius: 20,
          padding: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          border: `1px solid ${INPUT_BORDER}`,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 20,
            color: TEXT_PRIMARY,
          }}
        >
          업체 등록
        </div>

        <div style={{ ...sectionCardStyle, marginBottom: 16 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              marginBottom: 14,
              color: TEXT_PRIMARY,
            }}
          >
            업체 정보
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 130px',
                gap: 10,
              }}
            >
              <div>
                <input
                  value={customerForm.company_name}
                  onChange={(e) => { setCustomerForm((prev) => ({ ...prev, company_name: e.target.value })); clearError('company_name') }}
                  placeholder="업체명(company_name)"
                  style={errors.company_name ? { ...inputStyle, border: errBorder } : inputStyle}
                />
                <FieldError message={errors.company_name} />
              </div>

              <select
                value={customerForm.status}
                onChange={(e) =>
                  setCustomerForm((prev) => ({
                    ...prev,
                    status: e.target.value,
                  }))
                }
                style={inputStyle}
              >
                <option value="활성">활성</option>
                <option value="잠재">잠재</option>
                <option value="이탈">이탈</option>
              </select>
            </div>

            <input
              value={customerForm.address}
              onChange={(e) => { setCustomerForm((prev) => ({ ...prev, address: e.target.value })); clearError('address') }}
              placeholder="주소(전체 주소를 입력 ex. 울산광역시 북구 명촌 7길 30)"
              style={errors.address ? { ...inputStyle, border: errBorder } : inputStyle}
            />
            <FieldError message={errors.address} />

            <input
              value={customerForm.agency}
              onChange={(e) =>
                setCustomerForm((prev) => ({
                  ...prev,
                  agency: e.target.value,
                }))
              }
              placeholder="대리점(agency)"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ ...sectionCardStyle, marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 800, color: TEXT_PRIMARY }}>
              장비 정보
            </div>

            <button
              type="button"
              onClick={addDeviceFormCard}
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: WHITE_BUTTON_BG,
                color: WHITE_BUTTON_TEXT,
                border: 'none',
                cursor: 'pointer',
                fontSize: 24,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              }}
            >
              +
            </button>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            {deviceForms.map((device, index) => (
              <div
                key={index}
                style={{
                  border: `1px solid ${INPUT_BORDER}`,
                  borderRadius: 14,
                  padding: 14,
                  background: CARD_BG,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: TEXT_PRIMARY }}>
                    장비 {index + 1}
                  </div>

                  {deviceForms.length > 1 && (
                    <button
                      type="button"
                      onClick={() => { removeDeviceFormCard(index); clearDeviceErrors() }}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: `1px solid ${INPUT_BORDER}`,
                        background: PANEL_BG,
                        color: TEXT_PRIMARY,
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      삭제
                    </button>
                  )}
                </div>

                <div style={{ display: 'grid', gap: 12 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 10,
                    }}
                  >
                    <input
                      value={device.device_name}
                      onChange={(e) => { updateDeviceForm(index, 'device_name', e.target.value); clearError(`device_${index}`) }}
                      placeholder="장비 라인업(ex. SURFCOM)"
                      style={errors[`device_${index}`] ? { ...inputStyle, fontSize: 12, border: errBorder } : { ...inputStyle, fontSize: 12 }}
                    />

                    <input
                      value={device.device_name2}
                      onChange={(e) =>
                        updateDeviceForm(index, 'device_name2', e.target.value)
                      }
                      placeholder="장비 모델명(ex. 1600D)"
                      style={{ ...inputStyle, fontSize: 12 }}
                    />

                    <input
                      value={device.option}
                      onChange={(e) =>
                        updateDeviceForm(index, 'option', e.target.value)
                      }
                      placeholder="옵션(ex. -12)"
                      style={{ ...inputStyle, fontSize: 12 }}
                    />
                  </div>
                  <FieldError message={errors[`device_${index}`]} />

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                    }}
                  >
                    <input
                      value={device.serial_number}
                      onChange={(e) =>
                        updateDeviceForm(index, 'serial_number', e.target.value)
                      }
                      placeholder="시리얼넘버(serial_number)"
                      style={inputStyle}
                    />

                    <select
                      value={device.program}
                      onChange={(e) =>
                        updateDeviceForm(index, 'program', e.target.value)
                      }
                      style={inputStyle}
                    >
                      <option value="ACCTee">ACCTee</option>
                      <option value="Tims">Tims</option>
                      <option value="CALYPSO">CALYPSO</option>
                      <option value="없음">없음</option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 10,
                    }}
                  >
                    <input
                      type="date"
                      className="white-date"
                      value={device.install_date}
                      onChange={(e) =>
                        updateDeviceForm(index, 'install_date', e.target.value)
                      }
                      style={dateInputStyle}
                    />

                    <select
                      value={device.category}
                      onChange={(e) =>
                        updateDeviceForm(index, 'category', e.target.value)
                      }
                      style={inputStyle}
                    >
                      <option value="20">구분: 20</option>
                      <option value="81">구분: 81</option>
                      <option value="83">구분: 83</option>
                      <option value="84">구분: 84</option>
                    </select>
                  </div>

                  <label
                    style={{
                      ...inputStyle,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      overflow: 'hidden',
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        color: WHITE_BUTTON_TEXT,
                        background: WHITE_BUTTON_BG,
                        borderRadius: 7,
                        padding: '5px 10px',
                      }}
                    >
                      파일 선택
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: device.packing_file ? TEXT_PRIMARY : '#9ca3af',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {device.packing_file
                        ? device.packing_file.name
                        : '납입의사록•패킹리스트 파일 선택'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.xlsx,.xls,.doc,.docx,.png,.jpg,.jpeg"
                      onChange={(e) =>
                        updateDeviceForm(
                          index,
                          'packing_file',
                          e.target.files?.[0] ?? null
                        )
                      }
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...sectionCardStyle, marginBottom: 16 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              marginBottom: 14,
              color: TEXT_PRIMARY,
            }}
          >
            담당자 정보
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <input
              value={contactForm.department}
              onChange={(e) =>
                setContactForm((prev) => ({
                  ...prev,
                  department: e.target.value,
                }))
              }
              placeholder="부서(department)"
              style={inputStyle}
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}
            >
              <div>
                <input
                  value={contactForm.name}
                  onChange={(e) => { setContactForm((prev) => ({ ...prev, name: e.target.value })); clearError('contact_name') }}
                  placeholder="이름(name)"
                  style={errors.contact_name ? { ...inputStyle, border: errBorder } : inputStyle}
                />
                <FieldError message={errors.contact_name} />
              </div>

              <input
                value={contactForm.position}
                onChange={(e) =>
                  setContactForm((prev) => ({
                    ...prev,
                    position: e.target.value,
                  }))
                }
                placeholder="직책(position)"
                style={inputStyle}
              />
            </div>

            <input
              value={contactForm.phone}
              onChange={(e) =>
                setContactForm((prev) => ({
                  ...prev,
                  phone: e.target.value,
                }))
              }
              placeholder="전화번호(phone)"
              style={inputStyle}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 20,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '10px 14px',
              background: PANEL_BG,
              color: TEXT_PRIMARY,
              borderRadius: 10,
              border: `1px solid ${INPUT_BORDER}`,
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            취소
          </button>

          <button
            onClick={handleSave}
            disabled={isSavingCustomer}
            style={{
              padding: '10px 14px',
              background: WHITE_BUTTON_BG,
              color: WHITE_BUTTON_TEXT,
              borderRadius: 10,
              border: `1px solid ${INPUT_BORDER}`,
              cursor: 'pointer',
              fontWeight: 700,
              opacity: isSavingCustomer ? 0.7 : 1,
            }}
          >
            {isSavingCustomer ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}