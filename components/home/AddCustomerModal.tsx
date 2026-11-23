'use client'

/**
 * 업체 등록 — **한 폼으로 회사·사업장·대리점을 모두 받는다.**
 *
 *   ① 종류   고객사 | 대리점
 *   ② 업체   업체명(한글) · 영문명 · 분류          ← 한 줄 세 칸. 회사 줄이 된다
 *   ③ 사업장 사업장명 · 대리점 · 상태 / 주소 / **그 사업장의 고객 담당자**
 *            「+ 사업장 더 추가」로 여러 곳, 사업장마다 담당자 여럿
 *
 * ── 담당자를 사업장 블록 안에 둔 이유 ────────────────────────────────────
 *   전에는 담당자 칸이 폼 맨 아래 따로 있고 「어느 사업장의 담당자인가요」를 또 골라야 했다.
 *   사업장을 적는 자리에서 바로 그 사업장의 사람을 적는 편이 짧고, 고를 일이 없어 틀릴 일도 없다.
 *
 * ── 기존 회사면 ② 가 잠긴다 ──────────────────────────────────────────────
 *   업체명을 적는 동안 회사 목록에서 같은 이름을 찾는다. 있으면 「기존 회사에 사업장 추가」로
 *   바뀌어 ② 는 읽기 전용이 된다 — 같은 회사가 이름만 조금 달라 두 줄로 갈리는 것을 막는다.
 *
 * 장비 칸은 없다. 장비는 사업장 상세의 장비 탭에서 넣는다.
 */

import { useEffect, useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import FormFocusStyle from '@/components/common/FormFocusStyle'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import AddressField from '@/components/customer/modals/AddressField'
import AgencyPicker from '@/components/customer/AgencyPicker'
import { loadParents, type ParentOption } from '@/components/customer/ParentPicker'
import { matchesCompanyPick } from '@/lib/companySearch'
import { INDUSTRIES } from '@/lib/leadOptions'
import { addCustomerEntry, type NewContactInput, type NewSiteInput } from '@/lib/addCustomer'
import { R } from '@/lib/radius'
import { LABEL_WEIGHT, TEXT_LABEL } from '@/lib/textTokens'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const LABEL = '#374151'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'

/** 칸 이름 — 읽히라고 있는 글자다. 회색이 너무 옅어 안 보이던 것을 진하게 바꿨다(2026-11-20). */
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: LABEL_WEIGHT, color: TEXT_LABEL, marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: R.icon,
  boxSizing: 'border-box', color: TEXT, background: '#fff', outline: 'none', fontSize: 14,
}
const sectionStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: R.control, padding: 16, marginBottom: 14, background: '#fff',
}
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }
/** 한 줄 세 칸 — 업체 정보와 사업장 첫 줄이 같은 리듬을 쓴다. */
const row3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, alignItems: 'start' }

const emptyContact = (): NewContactInput => ({ name: '', position: '', department: '', phone: '', email: '' })
const emptySite = (): SiteDraft => ({ siteName: '', address: '', agencyId: null, agencyChosen: false, agencyQuery: '', status: '활성', contacts: [emptyContact()] })

/** 화면에서 다루는 사업장 한 블록. agencyQuery 는 **고르지 않고 적기만 한 글자**를 붙잡아 둔다. */
/**
 * 화면에서 다루는 사업장 한 블록.
 *   agencyQuery  … 고르지 않고 **적기만 한** 글자(그대로 저장하면 조용히 직판이 된다).
 *   agencyChosen … 대리점을 **골랐는가**. 직판도 골라야 한다 — 둘 다 값이 null 이라 이 칸이 가른다.
 */
type SiteDraft = NewSiteInput & { agencyQuery: string; agencyChosen: boolean }

type ErrKey =
  | 'companyName' | 'nameEn' | 'industry'
  | `site_${number}` | `siteName_${number}` | `agency_${number}` | `contact_${number}_${number}`

type Props = {
  /**
   * 열자마자 「기존 회사에 사업장 추가」로 둘 회사. 회사 카드의 「+ 사업장 추가」와
   * 회사를 골라 둔 채 누른 헤더의 「+ 업체 등록」이 이 값을 준다.
   *
   * 이 조각은 **열 때만 그려진다**(부르는 쪽이 key 를 준다) — 그래서 열 때마다 칸을
   * 비우는 effect 가 필요 없다. 처음 값은 useState 의 초기값이 전부다.
   */
  presetCompanyId?: number | null
  onClose: () => void
  /** 저장이 끝났다 — 화면이 목록을 다시 읽고 메시지를 띄운다. */
  onSaved: (message: string) => void
  onError: (message: string) => void
}

export default function AddCustomerModal({ presetCompanyId, onClose, onSaved, onError }: Props) {
  const { errors, clearError, validate } = useFieldErrors<ErrKey>()
  const [kind, setKind] = useState<'customer' | 'agency'>('customer')
  const [companyName, setCompanyName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [industry, setIndustry] = useState('')
  const [sites, setSites] = useState<SiteDraft[]>([emptySite()])
  const [saving, setSaving] = useState(false)
  const [companies, setCompanies] = useState<ParentOption[]>([])

  // 회사 목록 — 적은 이름이 **이미 있는 회사인지** 가리는 데 쓴다(ParentPicker 캐시를 함께 쓴다).
  useEffect(() => {
    let cancelled = false
    loadParents().then(list => { if (!cancelled) setCompanies(list) })
    return () => { cancelled = true }
  }, [])

  /** 고정된 회사(「+ 사업장 추가」로 열었을 때) — 이름·영문명·분류는 그 줄의 값을 보여 준다. */
  const preset = useMemo(
    () => (presetCompanyId == null ? null : companies.find(c => c.customer_id === presetCompanyId) ?? null),
    [companies, presetCompanyId],
  )

  /** 적은 이름과 **같은 이름의 회사**. 있으면 그 줄에 사업장을 더한다. */
  const matched = useMemo(() => {
    const q = companyName.trim().toLowerCase()
    if (!q) return null
    return companies.find(c => c.company_name.trim().toLowerCase() === q) ?? null
  }, [companies, companyName])

  /**
   * 대리점 양식인가. **「기존 회사에 사업장 추가」로 열었으면 늘 고객사 양식**이다
   * (2026-11-20) — 회사 카드의 + 로 들어온 길에서는 대리점을 만들 수 없는데도,
   * 세그먼트가 대리점에 가 있으면 「대리점 정보 / 대리점명」 라벨이 나왔다.
   */
  const isAgency = kind === 'agency' && presetCompanyId == null
  /** 이 회사에 사업장만 더하는 중인가 — 고정된 회사이거나, 적은 이름이 이미 있는 회사다. */
  const company = preset ?? (isAgency ? null : matched)
  const existing = company != null
  /** 이름이 비슷한 회사 — 똑같지는 않지만 눌러서 고를 수 있게 보여 준다. */
  const similar = useMemo(() => {
    const q = companyName.trim().toLowerCase()
    if (!q || existing || isAgency) return []
    return companies.filter(c => matchesCompanyPick(c, companyName)).slice(0, 4)
  }, [companies, companyName, existing, isAgency])

  const setSite = (i: number, patch: Partial<SiteDraft>) => {
    setSites(prev => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  }
  const setContact = (si: number, ci: number, patch: Partial<NewContactInput>) => {
    setSites(prev => prev.map((s, n) => (n === si
      ? { ...s, contacts: s.contacts.map((c, m) => (m === ci ? { ...c, ...patch } : c)) }
      : s)))
  }
  const contactFilled = (c: NewContactInput) =>
    [c.name, c.position, c.department, c.phone, c.email].some(v => v.trim())

  /**
   * 첫 오류 칸으로 데려간다 — 폼이 길어(사업장 여럿·담당자 여럿) 어디가 비었는지
   * 화면 밖일 수 있다. 빨간 테두리만 세우고 끝내면 저장이 안 되는 이유를 못 찾는다.
   */
  const scrollToFirstError = () => {
    requestAnimationFrame(() => {
      const box = document.querySelector('.acc-form')
      const bad = box?.querySelector<HTMLElement>('[data-err="1"]')
      if (!bad) return
      bad.scrollIntoView({ block: 'center', behavior: 'smooth' })
      bad.focus?.()
    })
  }

  const handleSave = async () => {
    const rules: Partial<Record<ErrKey, string | null>> = {
      companyName: (company?.company_name ?? companyName).trim() ? null : (isAgency ? '대리점명을 입력해주세요' : '업체명을 입력해주세요'),
      // 영문명은 **새로 만들 때** 필수다. 기존 회사에 사업장을 더하는 중이면 그 회사 값을 쓴다.
      nameEn: existing || nameEn.trim() ? null : '영문명을 입력해주세요',
      industry: isAgency || existing || industry ? null : '분류를 선택해주세요',
    }
    const shown = isAgency ? sites.slice(0, 1) : sites
    shown.forEach((s, i) => {
      // 대리점은 주소를 **선택**으로 둔다 — 등록된 45곳 중 29곳이 이름만으로 부르는 거래처다.
      rules[`site_${i}`] = isAgency || s.address.trim() ? null : '주소를 입력해주세요'
      rules[`siteName_${i}`] = isAgency || s.siteName.trim() ? null : '사업장명을 입력해주세요'
      // 대리점은 **고르는 칸**이다. 적기만 한 글자는 저장되지 않고, 고르지 않으면 넘어가지 못한다
      // — 거치지 않는 건이면 ACCT-K를 고른다(비워 두는 것과 뜻이 다르다).
      rules[`agency_${i}`] = isAgency ? null
        : s.agencyQuery.trim() && !s.agencyChosen ? '대리점을 목록에서 고르세요'
        : !s.agencyChosen ? '대리점을 고르세요 (거치지 않으면 ACCT-K)'
        : null
      s.contacts.forEach((c, ci) => {
        // 담당자 블록은 **선택**이다. 한 칸이라도 적었으면 이름·전화는 있어야 연락이 된다.
        const need = contactFilled(c) ? (!c.name.trim() ? '담당자 이름을 입력해주세요' : !c.phone.trim() ? '담당자 전화번호를 입력해주세요' : null) : null
        rules[`contact_${i}_${ci}`] = need
      })
    })
    if (!validate(rules)) { scrollToFirstError(); return }

    setSaving(true)
    try {
      const r = await addCustomerEntry({
        kind,
        companyName: company ? company.company_name : companyName,
        nameEn,
        industry: isAgency ? '' : (existing ? (company?.industry ?? '') : industry),
        existingCompanyId: existing ? (company?.customer_id ?? null) : null,
        sites: shown.map(s => ({
          siteName: s.siteName,
          address: s.address,
          agencyId: s.agencyId,
          status: s.status,
          contacts: s.contacts.filter(contactFilled),
        })),
      })
      onSaved(r.message)
    } catch (e) {
      onError((e as Error)?.message || '등록하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  const segBtn = (on: boolean): React.CSSProperties => ({
    height: 28, padding: '0 14px', borderRadius: R.icon, border: 'none', cursor: 'pointer',
    background: on ? '#fff' : 'transparent', color: on ? TEXT : MUTED,
    fontSize: 13, fontWeight: on ? 700 : 500, fontFamily: 'inherit',
    boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  })
  const smallBtn: React.CSSProperties = {
    height: 26, padding: '0 10px', borderRadius: R.icon, border: `1px solid ${BORDER}`,
    background: '#fff', color: TEXT, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  }

  return (
    <ModalOverlay onClose={onClose} confirmClose>
      {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정.
          ✕ 는 Esc·바깥 클릭과 **같은 함수**를 지난다(ModalCard). */}
      <ModalCard
        width={1100}
        className="acc-form"
        title={<>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>
            {existing ? '기존 회사에 사업장 추가' : isAgency ? '대리점 등록' : '업체 등록'}
          </div>
          <span style={{ flex: 1 }} />
          {/* 종류 세그먼트는 **새 업체 등록**에서만 낸다 — 사업장을 더하는 길에는 고를 것이 없다. */}
          {presetCompanyId == null && (
            <div style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: R.control, background: NEUTRAL }}>
              <button type="button" onClick={() => setKind('customer')} style={segBtn(!isAgency)}>고객사</button>
              <button type="button" onClick={() => setKind('agency')} style={segBtn(isAgency)}>대리점</button>
            </div>
          )}
        </>}
        footer={<>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '10px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={() => void handleSave()} disabled={saving}
            style={{ padding: '10px 17px', background: BLUE, color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </>}
      >
        <FormFocusStyle />

        {/* ── ② 업체 정보 — 한 줄 세 칸 ── */}
        <section style={sectionStyle}>
          <div style={sectionTitle}>{isAgency ? '대리점 정보' : '업체 정보'}</div>
          {existing && (
            <div style={{ fontSize: 11, color: BLUE, background: '#eff4ff', border: '1px solid #c7d7f8', borderRadius: R.icon, padding: '7px 10px', marginBottom: 10 }}>
              이미 있는 회사입니다 — 아래 사업장만 이 회사에 더합니다.
            </div>
          )}
          <div style={isAgency ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'start' } : row3}>
            <div data-err={errors.companyName ? '1' : undefined}>
              <div style={labelStyle}>{isAgency ? '대리점명' : '업체명'}</div>
              <input value={preset ? preset.company_name : companyName} disabled={saving || preset != null}
                onChange={e => { setCompanyName(e.target.value); clearError('companyName') }}
                placeholder={isAgency ? 'ex) 젠트' : 'ex) 현대자동차'}
                style={{
                  ...inputStyle,
                  ...(errors.companyName ? { border: errBorder } : null),
                  ...(preset ? { background: '#f9fafb', color: MUTED } : null),
                }} />
              <FieldError message={errors.companyName} />
            </div>

            <div data-err={errors.nameEn ? '1' : undefined}>
              <div style={labelStyle}>영문명</div>
              <input value={existing ? (company?.name_en ?? '') : nameEn} disabled={saving || existing}
                onChange={e => { setNameEn(e.target.value); clearError('nameEn') }}
                placeholder="ex) HYUNDAI MOTOR"
                style={{
                  ...inputStyle,
                  ...(errors.nameEn ? { border: errBorder } : null),
                  ...(existing ? { background: '#f9fafb', color: MUTED } : null),
                }} />
              <FieldError message={errors.nameEn} />
            </div>

            {!isAgency && (
              <div data-err={errors.industry ? '1' : undefined}>
                <div style={labelStyle}>분류</div>
                <select value={existing ? (company?.industry ?? '') : industry} disabled={saving || existing}
                  onChange={e => { setIndustry(e.target.value); clearError('industry') }}
                  style={{
                    ...inputStyle, cursor: 'pointer',
                    ...(errors.industry ? { border: errBorder } : null),
                    ...(existing ? { background: '#f9fafb', color: MUTED } : null),
                  }}>
                  <option value="" disabled hidden>분류 선택</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
                <FieldError message={errors.industry} />
              </div>
            )}
          </div>

          {/* 비슷한 이름 — 눌러서 그 회사에 붙인다(같은 회사가 두 줄로 갈리지 않게). */}
          {similar.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 9 }}>
              <span style={{ fontSize: 11, color: MUTED, lineHeight: '22px' }}>비슷한 회사:</span>
              {similar.map(c => (
                <button key={c.customer_id} type="button" onClick={() => setCompanyName(c.company_name)}
                  style={{ ...smallBtn, height: 22, color: SUB }}>
                  {c.company_name}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── ③ 사업장 ── */}
        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ ...sectionTitle, marginBottom: 0 }}>{isAgency ? '주소 · 상태' : `사업장 ${sites.length}곳`}</div>
            <span style={{ flex: 1 }} />
            {!isAgency && (
              <button type="button" onClick={() => setSites(prev => [...prev, emptySite()])} disabled={saving} style={smallBtn}>
                + 사업장
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            {(isAgency ? sites.slice(0, 1) : sites).map((site, i) => (
              <div key={i} style={{ display: 'grid', gap: 10, padding: isAgency ? 0 : 12, border: isAgency ? 'none' : `1px solid ${BORDER}`, borderRadius: R.control }}>
                {!isAgency && (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <b style={{ fontSize: 12, fontWeight: 700, color: LABEL }}>사업장 {i + 1}</b>
                    <span style={{ flex: 1 }} />
                    {sites.length > 1 && (
                      <button type="button" onClick={() => setSites(prev => prev.filter((_, n) => n !== i))} disabled={saving}
                        style={{ border: 'none', background: 'none', color: MUTED, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        삭제
                      </button>
                    )}
                  </div>
                )}

                {/* 첫 줄 — 사업장명 · 대리점 · 상태 */}
                {!isAgency && (
                  <div style={row3}>
                    <div data-err={errors[`siteName_${i}`] ? '1' : undefined}>
                      <div style={labelStyle}>사업장명</div>
                      <input value={site.siteName} disabled={saving}
                        onChange={e => { setSite(i, { siteName: e.target.value }); clearError(`siteName_${i}`) }}
                        placeholder="ex) 본사, A공장, 지명"
                        style={errors[`siteName_${i}`] ? { ...inputStyle, border: errBorder } : inputStyle} />
                      <FieldError message={errors[`siteName_${i}`]} />
                    </div>
                    <div data-err={errors[`agency_${i}`] ? '1' : undefined}>
                      <div style={labelStyle}>대리점</div>
                      {/* 자유 입력이 아니라 **고르는 칸**이다. 적기만 하면 저장 때 막힌다. */}
                      <AgencyPicker
                        value={site.agencyId}
                        chosen={site.agencyChosen}
                        onChange={(id, picked) => { setSite(i, { agencyId: id, agencyChosen: picked !== false, agencyQuery: '' }); clearError(`agency_${i}`) }}
                        onQueryChange={q => { setSite(i, { agencyQuery: q }); clearError(`agency_${i}`) }}
                        disabled={saving}
                        inputStyle={errors[`agency_${i}`] ? { ...inputStyle, border: errBorder } : inputStyle}
                      />
                      <FieldError message={errors[`agency_${i}`]} />
                    </div>
                    <div>
                      <div style={labelStyle}>상태</div>
                      <select value={site.status} disabled={saving}
                        onChange={e => setSite(i, { status: e.target.value })}
                        style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="활성">활성</option>
                        <option value="잠재">잠재</option>
                        <option value="이탈">이탈</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* 둘째 줄 — 주소 */}
                <div data-err={errors[`site_${i}`] ? '1' : undefined}>
                  <div style={labelStyle}>{isAgency ? '주소 (선택)' : '주소'}</div>
                  <AddressField
                    value={site.address}
                    onChange={next => setSite(i, { address: next })}
                    onTouch={() => clearError(`site_${i}`)}
                    error={errors[`site_${i}`]}
                    inputStyle={inputStyle}
                    errorBorder={errBorder}
                    disabled={saving}
                  />
                  <FieldError message={errors[`site_${i}`]} />
                </div>

                {isAgency && (
                  <div style={{ maxWidth: 220 }}>
                    <div style={labelStyle}>상태</div>
                    <select value={site.status} disabled={saving}
                      onChange={e => setSite(i, { status: e.target.value })}
                      style={{ ...inputStyle, cursor: 'pointer' }}>
                      <option value="활성">활성</option>
                      <option value="잠재">잠재</option>
                      <option value="이탈">이탈</option>
                    </select>
                  </div>
                )}

                {/* 셋째 — 이 사업장의 고객 담당자 */}
                {!isAgency && (
                  <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                      <b style={{ fontSize: 12, fontWeight: 700, color: LABEL }}>고객 담당자</b>
                      <span style={{ flex: 1 }} />
                      <button type="button" disabled={saving} style={smallBtn}
                        onClick={() => setSites(prev => prev.map((s, n) => (n === i ? { ...s, contacts: [...s.contacts, emptyContact()] } : s)))}>
                        + 담당자
                      </button>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {site.contacts.map((c, ci) => (
                        <div key={ci} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 26px', gap: 8, alignItems: 'start' }}>
                          <div data-err={errors[`contact_${i}_${ci}`] ? '1' : undefined}>
                            {ci === 0 && <div style={labelStyle}>이름</div>}
                            <input value={c.name} disabled={saving}
                              onChange={e => { setContact(i, ci, { name: e.target.value }); clearError(`contact_${i}_${ci}`) }}
                              placeholder="이름"
                              style={errors[`contact_${i}_${ci}`] ? { ...inputStyle, border: errBorder } : inputStyle} />
                            <FieldError message={errors[`contact_${i}_${ci}`]} />
                          </div>
                          <div>
                            {ci === 0 && <div style={labelStyle}>직급</div>}
                            <input value={c.position} disabled={saving}
                              onChange={e => setContact(i, ci, { position: e.target.value })}
                              placeholder="직급" style={inputStyle} />
                          </div>
                          <div>
                            {ci === 0 && <div style={labelStyle}>부서</div>}
                            <input value={c.department} disabled={saving}
                              onChange={e => setContact(i, ci, { department: e.target.value })}
                              placeholder="부서" style={inputStyle} />
                          </div>
                          <div>
                            {ci === 0 && <div style={labelStyle}>전화</div>}
                            <input value={c.phone} disabled={saving}
                              onChange={e => { setContact(i, ci, { phone: e.target.value }); clearError(`contact_${i}_${ci}`) }}
                              placeholder="전화번호"
                              style={errors[`contact_${i}_${ci}`]?.includes('전화') ? { ...inputStyle, border: errBorder } : inputStyle} />
                          </div>
                          <div>
                            {ci === 0 && <div style={labelStyle}>이메일</div>}
                            <input value={c.email} disabled={saving} type="email"
                              onChange={e => setContact(i, ci, { email: e.target.value })}
                              placeholder="이메일" style={inputStyle} />
                          </div>
                          <div style={{ paddingTop: ci === 0 ? 19 : 0 }}>
                            {site.contacts.length > 1 && (
                              <button type="button" disabled={saving} aria-label="담당자 삭제" title="담당자 삭제"
                                onClick={() => setSites(prev => prev.map((s, n) => (n === i ? { ...s, contacts: s.contacts.filter((_, m) => m !== ci) } : s)))}
                                style={{ width: 26, height: 38, padding: 0, border: 'none', background: 'none', color: MUTED, cursor: 'pointer' }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

      </ModalCard>
    </ModalOverlay>
  )
}
