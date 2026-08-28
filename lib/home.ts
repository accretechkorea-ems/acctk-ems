import type { CSSProperties } from 'react'

export type Customer = {
  customer_id: number
  company_name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  status: string | null
  agency: string | null
  category: string | null
}

export type Device = {
  device_id?: number
  customer_id: number
  device_name: string | null
  device_name2: string | null
  option: string | null
  serial_number: string | null
  program: string | null
  install_date: string | null
  category: string | null
  packing_list_url: string | null
}

export type Contact = {
  contact_id?: number
  customer_id?: number
  name: string
  department: string
  position: string
  phone: string
}

export type ServiceHistory = {
  customer_id: number
  visit_date: string | null
}

export type NewDeviceForm = {
  device_name: string
  device_name2: string
  option: string
  serial_number: string
  program: string
  install_date: string
  category: string
  packing_file: File | null
}

export const HOME_STATE_KEY = 'customer-map-home-state-v2'

export const PAGE_BG = '#ffffff'
export const PANEL_BG = '#ffffff'
export const CARD_BG = '#ffffff'
export const INPUT_BG = '#ffffff'
export const INPUT_BORDER = '#e5e7eb'
export const TEXT_PRIMARY = '#111111'
export const TEXT_SECONDARY = '#555555'
export const TEXT_MUTED = '#888888'
export const WHITE_BUTTON_BG = '#f4f4f5'
export const WHITE_BUTTON_TEXT = '#111113'
export const RADIUS = 12

// BASE_LAT/BASE_LNG(울산 사무실 좌표)는 lib/offices.ts 의 OFFICES 로 통합했다.
export const BASE_NAME = '울산광역시 북구 명촌 7길 30'

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: 12,
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: 10,
  background: INPUT_BG,
  color: TEXT_PRIMARY,
  boxSizing: 'border-box',
  outline: 'none',
}

export const dateInputStyle: CSSProperties = {
  ...inputStyle,
  background: INPUT_BG,
  color: TEXT_PRIMARY,
  colorScheme: 'dark',
}

export const sectionCardStyle: CSSProperties = {
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: 16,
  padding: 16,
  background: PANEL_BG,
}

export function createEmptyDeviceForm(): NewDeviceForm {
  return {
    device_name: '',
    device_name2: '',
    option: '',
    serial_number: '',
    program: 'ACCTee',
    install_date: '',
    category: '20',
    packing_file: null,
  }
}

// 사용자가 아무것도 채우지 않은 장비 카드인지.
// program·category 는 기본값이 미리 들어 있어 판정에서 뺀다(비어 있음의 근거가 못 된다).
export function isEmptyDeviceForm(d: NewDeviceForm): boolean {
  return !d.device_name.trim()
    && !d.device_name2.trim()
    && !d.option.trim()
    && !d.serial_number.trim()
    && !d.install_date.trim()
    && !d.packing_file
}

// 담당자도 같은 방식 — 이름·부서·직책·전화가 모두 비면 입력하지 않은 것으로 본다.
export function isEmptyContactForm(c: { name: string; department: string; position: string; phone: string }): boolean {
  return !c.name.trim() && !c.department.trim() && !c.position.trim() && !c.phone.trim()
}

export function getDeviceLines(devices: Device[]): string[] {
  if (!devices || devices.length === 0) return ['-']

  return devices
    .map((d) => {
      const name = `${d.device_name ?? ''}${d.device_name2 ?? ''}${d.option ?? ''}`.trim()
      const program = d.program ? `(${d.program})` : ''
      const combined = `${name}${program}`.trim()
      return combined
    })
    .filter(Boolean)
}

export function getDeviceLine(devices: Device[]): string {
  return getDeviceLines(devices).join(' / ')
}

export function toTimeValue(value: string | null | undefined): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

export function controlButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: RADIUS,
    border: `1px solid ${INPUT_BORDER}`,
    background: active ? WHITE_BUTTON_BG : PANEL_BG,
    color: active ? WHITE_BUTTON_TEXT : TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxSizing: 'border-box',
    minWidth: 70,
  }
}