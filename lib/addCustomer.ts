import { createClient } from '@/lib/supabase/client'
import { createEmptyDeviceForm, isEmptyDeviceForm, isEmptyContactForm, type NewDeviceForm } from '@/lib/home'

export const addCustomer = async ({
  customerForm,
  contactForm,
  deviceForms,
  fetchData,
  resetForms,
  setIsSavingCustomer,
  setIsAddCustomerModalOpen,
  setQuery,
}: any) => {
  const supabase = createClient()

  // 사용자 검증은 호출 컴포넌트(AddCustomerModal)에서 인라인으로 처리한다.
  // 여기서는 방어용 최소 가드만 둔다 (throw → 호출부 catch 에서 toast.error 로 표면화).
  if (!customerForm.company_name?.trim()) throw new Error('업체명을 입력해주세요')

  setIsSavingCustomer(true)

  let insertedCustomerId = 0

  try {
    const { geocodeAddress } = await import('@/lib/geocode')
    const coords = await geocodeAddress(customerForm.address)

    const { data: insertedCustomer, error: customerError } = await supabase
      .from('customers')
      .insert([
        {
          company_name: customerForm.company_name.trim(),
          address: customerForm.address.trim(),
          agency: customerForm.agency.trim() || null,
          status: customerForm.status,
          // 상위 업체(선택). 나중에 따로 UPDATE 하면 실패했을 때 연결이 빠진 채 남으므로 함께 넣는다.
          parent_customer_id: customerForm.parent_customer_id ?? null,
          latitude: coords.latitude,
          longitude: coords.longitude,
        },
      ])
      .select('customer_id')
      .single()

    if (customerError || !insertedCustomer) {
      throw customerError || new Error('customers 저장 실패')
    }

    insertedCustomerId = insertedCustomer.customer_id

    // 아무것도 입력하지 않은 장비 카드는 걸러낸다 (장비 없는 신규 업체도 등록 가능).
    const filledDevices: NewDeviceForm[] = deviceForms.filter((d: NewDeviceForm) => !isEmptyDeviceForm(d))
    const devicePayload = []
    for (let i = 0; i < filledDevices.length; i++) {
      const d = filledDevices[i]

      // 납입의사록·패킹리스트 파일이 있으면 packing-lists(비공개) 버킷에 업로드.
      // DB에는 전체 URL이 아니라 "저장 경로(파일명)"만 보관 → 열 때 서명 URL 발급.
      let packingPath: string | null = null
      if (d.packing_file) {
        const ext = d.packing_file.name.split('.').pop()
        const fileName = `packing-${insertedCustomerId}-${i}-${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('packing-lists')
          .upload(fileName, d.packing_file, { upsert: true })
        if (!upErr) {
          packingPath = fileName
        }
      }

      devicePayload.push({
        customer_id: insertedCustomerId,
        device_name: d.device_name.trim(),
        device_name2: d.device_name2.trim() || null,
        option: d.option.trim() || null,
        serial_number: d.serial_number.trim() || null,
        program: d.program,
        install_date: d.install_date || null,
        category: d.category,
        packing_list_url: packingPath,
      })
    }

    // 남은 것이 없으면 insert 자체를 건너뛴다.
    if (devicePayload.length > 0) {
      const { error: deviceError } = await supabase.from('devices').insert(devicePayload)
      if (deviceError) throw deviceError
    }

    // 담당자도 선택 사항 — 아무것도 입력하지 않았으면 넣지 않는다.
    if (!isEmptyContactForm(contactForm)) {
      const { error: contactError } = await supabase.from('contacts').insert([
        {
          customer_id: insertedCustomerId,
          name: contactForm.name.trim(),
          department: contactForm.department.trim() || null,
          position: contactForm.position.trim() || null,
          phone: contactForm.phone.trim() || null,
        },
      ])
      if (contactError) throw contactError
    }

    resetForms()
    setIsAddCustomerModalOpen(false)
    setQuery('')

    await fetchData()
    return true // 성공 여부를 반환 → 호출 컴포넌트에서 토스트 표시
  } catch (error: any) {
    console.error(error)

    if (insertedCustomerId) {
      await supabase.from('customers').delete().eq('customer_id', insertedCustomerId)
    }

    // 훅을 쓸 수 없는 모듈이므로 에러를 호출부로 전파 → 컴포넌트에서 toast.error 표시
    throw error
  } finally {
    setIsSavingCustomer(false)
  }
}