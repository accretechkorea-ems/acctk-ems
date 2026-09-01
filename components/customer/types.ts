export type Customer = {
  customer_id: number
  company_name: string | null
  address: string | null
  status: string | null
  agency: string | null
}

export type Device = {
  device_id: number
  customer_id: number
  device_name: string | null
  device_name2: string | null
  option: string | null
  serial_number: string | null
  packing_list_url: string | null
  install_date: string | null
  install_year: string | number | null
  program: string | null
  image_url: string | null
  category: string | null
}

export type Contact = {
  contact_id: number
  customer_id: number
  name: string | null
  department: string | null
  position: string | null
  phone: string | null
  email: string | null
}

export type ServiceHistory = {
  service_id: number
  customer_id: number
  device_id: number | null
  visit_date: string | null
  service_notes: string | null
  etc_notes: string | null
  visitor: string | null
  service_type: string | null
  contact_id: number | null
  is_paid: boolean | null
  work_hours: number | null
  start_time: string | null
  end_time: string | null
  report_url: string | null
  service_engineers?: { engineer_id: number; engineers: { name: string; position: string | null } }[]
}

export type SalesActivity = {
  activity_id: number
  opportunity_id: number | null
  customer_id: number
  engineer_id: number | null
  contact_id: number | null
  activity_date: string | null
  activity_type: string
  content: string | null
  created_at: string
  updated_at: string
  engineers?: { name: string; position: string | null } | null
  contacts?: { name: string | null; position: string | null } | null
  sales_opportunities?: { title: string } | null
}

export type HoldingNote = {
  note_id: number
  holding_id: number
  engineer_id: number | null
  content: string
  created_at: string
  engineers?: { name: string; position: string | null } | null
}

export type Holding = {
  holding_id: number
  service_id: number | null
  device_id: number
  customer_id: number
  title: string
  started_at: string
  resolved_at: string | null
  resolved_note: string | null
  created_by: number | null
  created_at: string
  updated_at: string
  devices?: { device_name: string | null; device_name2: string | null; serial_number: string | null } | null
  engineers?: { name: string; position: string | null } | null
  holding_notes?: HoldingNote[]
  // 홀딩 현황 화면에서만 함께 읽는다 (업체 상세는 이미 업체를 알고 있어 생략)
  customers?: { company_name: string | null } | null
}

export type HoldingForm = {
  title: string
  started_at: string
  first_note: string
}

export type SalesOpportunity = {
  opportunity_id: number
  customer_id: number
  engineer_id: number | null
  title: string
  stage: string
  expected_amount: number | null
  expected_close: string | null
  lost_reason: string | null
  lost_note: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  engineers?: { name: string; position: string | null } | null
  customers?: { company_name: string | null } | null
  // 이 기회에 연결된 견적 (quotes.opportunity_id 역방향 임베딩)
  quotes?: { quote_id: number; quote_number: string; quote_date: string; total_supply: number; status: string; pdf_url: string | null }[]
}

export type OpportunityForm = {
  customer_id: number | null   // 파이프라인에서 신규 등록할 때 고른다. 업체 상세에서는 그 업체로 고정
  title: string
  stage: string
  expected_amount: string       // 입력 중에는 문자열로 두고 저장할 때 숫자로 바꾼다
  expected_close: string        // 'YYYY-MM' (월 단위 입력)
  engineer_id: number | null
  lost_reason: string
  lost_note: string
}

export type SalesActivityForm = {
  opportunity_id: number | null
  activity_date: string
  activity_type: string
  contact_id: number | null
  content: string
}

export type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  resigned_date?: string | null
}

export type Quote = {
  quote_id: number
  quote_number: string
  quote_date: string
  customer_id: number | null
  dealer_id: number | null
  total_supply: number
  total_amount: number
  total_cost: number | null
  total_profit: number | null
  profit_rate: number | null
  status: string
  recipient: string | null
  // order_date · revenue_date 는 코드에서 쓰지 않는다(수주·매출 시점은 처리 시각 컬럼이 정본).
  pdf_url?: string | null
  engineers?: { name: string; position: string | null }
  quote_items?: { product_name: string | null; price_list?: { model_jp: string | null } | null }[]
}

export type ServiceForm = {
  visit_date: string
  service_notes: string
  etc_notes: string
  visitor: string
  service_type: string
  contact_id: number | null
  is_paid: boolean
  work_hours: string
  start_time: string
  end_time: string
}

export type DeviceForm = {
  device_name: string
  device_name2: string
  option: string
  serial_number: string
  program: string
  install_date: string
  category: string
}

export type ContactForm = {
  name: string
  department: string
  position: string
  phone: string
  email: string
}

export type CustomerEditFormData = {
  company_name: string
  address: string
  agency: string
  status: string
}
