import { deviceNameLine, deviceNames } from '@/lib/deviceName'
import type { CSSProperties } from 'react'
import { R } from '@/lib/radius'

export type Customer = {
  customer_id: number
  /**
   * 화면에 쓰는 **한 줄 이름** — 「회사명 사업장명」.
   * 읽어 올 때 lib/customerLabel.ts 의 customerDisplayName 으로 만들어 담는다
   * (hooks/useHomeData.ts). 그래서 카드·지도·엑셀은 이 칸만 읽으면 된다.
   */
  company_name: string
  /** 사업장명만(없으면 null). 회사명만 필요한 자리가 있어 함께 들고 있는다. */
  site_name?: string | null
  /** 회사명만 — 사업장이 여럿인 회사를 묶어 셀 때 쓴다. */
  company_only?: string | null
  /** 이 사업장을 묶는 회사 줄의 id. 없으면 「미연결」이다(목록 보기의 탭). */
  parent_customer_id?: number | null
  /** 지역1 — 목록 보기의 지역 칩이 쓴다. 비면 주소 앞 토큰으로 떨어진다. */
  region1?: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  status: string | null
  /**
   * 대리점 이름 — `agency_customer_id` 로 묶인 **대리점 줄의 company_name** 이다
   * (lib/customerAgency.ts). 직판이면 null. 옛 `agency` 텍스트 칸은 읽지 않는다.
   */
  agency_name: string | null
  /** 고른 대리점 줄의 id — 목록 보기의 표가 그 자리에서 고칠 때 쓴다. */
  agency_customer_id?: number | null
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
export const TEXT_MUTED = '#6b7280'
export const WHITE_BUTTON_BG = '#f4f4f5'
export const WHITE_BUTTON_TEXT = '#111113'
export const RADIUS = R.card

// 사무실 좌표·주소는 public.offices 테이블이 정본이다(lib/offices.ts 가 읽어 온다).


export const inputStyle: CSSProperties = {
  width: '100%',
  padding: 12,
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: R.tile,
  background: INPUT_BG,
  color: TEXT_PRIMARY,
  boxSizing: 'border-box',
  outline: 'none',
}

export const dateInputStyle: CSSProperties = {
  ...inputStyle,
  background: INPUT_BG,
  color: TEXT_PRIMARY,
  // 이 화면이 다크 테마였을 때 'dark' 였다. 그때는 브라우저가 달력 아이콘을 흰색으로 그렸고,
  // app/page.tsx 가 filter: invert(1) 로 되돌려 놓는 짝이 있었다. 라이트 테마로 바뀐 뒤로는
  // 둘 다 필요 없어 함께 지웠다(2026-09-29). 날짜 칸은 이 프로젝트 전체가 'light' 로 맞춘다.
  colorScheme: 'light',
}

export const sectionCardStyle: CSSProperties = {
  border: `1px solid ${INPUT_BORDER}`,
  borderRadius: R.modal,
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

/**
 * 장비 이름 줄 — 조립은 **공용 한 곳**이 한다(lib/deviceName.ts, 2026-11-27 묶음5 3-7).
 * 전에는 여기서 직접 이어 붙였는데, 프로그램이 글자 「없음」으로 저장된 줄에
 * **「…(없음)」** 꼬리가 붙었다. 「없음」은 값이 아니라 값이 없다는 말이다.
 */
export function getDeviceLines(devices: Device[]): string[] {
  if (!devices || devices.length === 0) return ['-']
  return deviceNames(devices)
}

export function getDeviceLine(devices: Device[]): string {
  return deviceNameLine(devices)
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