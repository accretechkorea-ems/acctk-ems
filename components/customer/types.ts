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
  visit_year: string | null
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
  total_supply: number
  total_amount: number
  total_cost: number | null
  total_profit: number | null
  profit_rate: number | null
  status: string
  subject: string | null
  recipient: string | null
  order_date: string | null
  revenue_date: string | null
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
