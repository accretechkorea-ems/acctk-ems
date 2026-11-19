'use client'

/**
 * 업체 등록 — **한 폼으로 회사·사업장·대리점을 모두 받는다.**
 *
 *   ① 종류   고객사 | 대리점
 *   ② 업체   업체명(한글)·영문명·분류          ← 회사 줄이 된다
 *   ③ 사업장 사업장명·주소·대리점·상태 (여러 곳) ← 사업장 줄이 된다
 *   ④ 담당자 선택. 사업장이 여럿이면 어느 곳인지 고른다
 *
 * ── 기존 회사면 ② 가 잠긴다 ──────────────────────────────────────────────
 *   업체명을 적는 동안 회사 목록에서 같은 이름을 찾는다. 있으면 「기존 회사에 사업장
 *   추가」로 바뀌어 ② 는 읽기 전용이 된다 — 같은 회사가 이름만 조금 달라 두 줄로
 *   갈리는 것이 이번 정리의 가장 큰 원인이었다.
 *   회사 카드의 「+ 사업장 추가」로 열면 처음부터 그 모드다.
 *
 * 장비 칸은 없다. 장비는 사업장 상세의 장비 탭에서 넣는다 — 등록할 때는 대개 아직
 * 장비가 정해지지 않았고, 폼만 길어졌다.
 */

import { useEffect, useMemo, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import { useFieldErrors, FieldError, errBorder } from '@/components/common/fieldErrors'
import AddressField from '@/components/customer/modals/AddressField'
import AgencyPicker from '@/components/customer/AgencyPicker'
import { loadParents, type ParentOption } from '@/components/customer/ParentPicker'
import { INDUSTRIES } from '@/lib/leadOptions'
import { addCustomerEntry, type NewSiteInput } from '@/lib/addCustomer'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 6,
  boxSizing: 'border-box', color: TEXT, background: '#fff', outline: 'none', fontSize: 14,
}
const sectionStyle: React.CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, marginBottom: 14, background: '#fff',
}
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 12 }

const emptySite = (): NewSiteInput => ({ siteName: '', address: '', agencyId: null, status: '활성' })

type ErrKey = 'companyName' | 'nameEn' | 'industry' | 'contact_name' | `site_${number}`

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
  const [sites, setSites] = useState<NewSiteInput[]>([emptySite()])
  const [contact, setContact] = useState({ name: '', department: '', position: '', phone: '', siteIndex: 0 })
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

  const isAgency = kind === 'agency'
  /** 이 회사에 사업장만 더하는 중인가 — 고정된 회사이거나, 적은 이름이 이미 있는 회사다. */
  const company = preset ?? (isAgency ? null : matched)
  const existing = company != null
  /** 이름이 비슷한 회사 — 똑같지는 않지만 눌러서 고를 수 있게 보여 준다. */
  const similar = useMemo(() => {
    const q = companyName.trim().toLowerCase()
    if (!q || existing || isAgency) return []
    return companies.filter(c => c.company_name.toLowerCase().includes(q)).slice(0, 4)
  }, [companies, companyName, existing, isAgency])

  const setSite = (i: number, patch: Partial<NewSiteInput>) => {
    setSites(prev => prev.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  }

  const handleSave = async () => {
    const rules: Partial<Record<ErrKey, string | null>> = {
      companyName: (company?.company_name ?? companyName).trim() ? null : (isAgency ? '대리점명을 입력해주세요' : '업체명을 입력해주세요'),
      // 영문명은 **새로 만들 때** 필수다. 기존 회사에 사업장을 더하는 중이면 그 회사 값을 쓴다.
      nameEn: existing || nameEn.trim() ? null : '영문명을 입력해주세요',
      industry: isAgency || existing || industry ? null : '분류를 선택해주세요',
      contact_name: !contact.name.trim() && (contact.department.trim() || contact.position.trim() || contact.phone.trim())
        ? '고객 담당자 이름을 입력해주세요'
        : null,
    }
    if (isAgency) {
      // 대리점은 주소를 **선택**으로 둔다 — 등록된 45곳 중 29곳이 이름만으로 부르는 거래처다.
      rules.site_0 = null
    } else {
      sites.forEach((s, i) => { rules[`site_${i}`] = s.address.trim() ? null : '주소를 입력해주세요' })
    }
    if (!validate(rules)) return

    setSaving(true)
    try {
      const r = await addCustomerEntry({
        kind,
        companyName: company ? company.company_name : companyName,
        nameEn,
        industry: isAgency ? '' : (existing ? (company?.industry ?? '') : industry),
        existingCompanyId: existing ? (company?.customer_id ?? null) : null,
        sites: isAgency ? [sites[0] ?? emptySite()] : sites,
        contact: contact.name.trim() ? contact : null,
      })
      onSaved(r.message)
    } catch (e) {
      onError((e as Error)?.message || '등록하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  const segBtn = (on: boolean): React.CSSProperties => ({
    height: 32, padding: '0 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: on ? '#fff' : 'transparent', color: on ? TEXT : MUTED,
    fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
  })

  return (
    <ModalOverlay onClose={onClose} confirmClose>
      <div onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto',
          background: '#fff', color: TEXT, borderRadius: 8, padding: 22,
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)', border: `1px solid ${BORDER}`,
        }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 16 }}>
          {existing ? '기존 회사에 사업장 추가' : isAgency ? '대리점 등록' : '업체 등록'}
        </div>

        {/* ── ① 종류 ── */}
        <div style={{ display: 'inline-flex', gap: 3, padding: 3, borderRadius: 8, background: NEUTRAL, marginBottom: 14 }}>
          <button type="button" onClick={() => setKind('customer')} style={segBtn(!isAgency)}>고객사</button>
          <button type="button" onClick={() => setKind('agency')} style={segBtn(isAgency)}>대리점</button>
        </div>

        {/* ── ② 업체 정보 ── */}
        <section style={sectionStyle}>
          <div style={sectionTitle}>{isAgency ? '대리점 정보' : '업체 정보'}</div>
          {existing && (
            <div style={{ fontSize: 11, color: BLUE, background: '#eff4ff', border: `1px solid #c7d7f8`, borderRadius: 6, padding: '7px 10px', marginBottom: 10 }}>
              이미 있는 회사입니다 — 아래 사업장만 이 회사에 더합니다.
            </div>
          )}
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <div style={labelStyle}>{isAgency ? '대리점명' : '업체명 (한글)'}</div>
              <input value={preset ? preset.company_name : companyName} disabled={saving || preset != null}
                onChange={e => { setCompanyName(e.target.value); clearError('companyName') }}
                placeholder={isAgency ? 'ex) 젠트' : 'ex) 현대자동차'}
                style={{
                  ...inputStyle,
                  ...(errors.companyName ? { border: errBorder } : null),
                  ...(preset ? { background: '#f9fafb', color: MUTED } : null),
                }} />
              <FieldError message={errors.companyName} />
              {/* 비슷한 이름 — 눌러서 그 회사에 붙인다(같은 회사가 두 줄로 갈리지 않게). */}
              {similar.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                  <span style={{ fontSize: 11, color: MUTED }}>비슷한 회사:</span>
                  {similar.map(c => (
                    <button key={c.customer_id} type="button" onClick={() => setCompanyName(c.company_name)}
                      style={{ height: 22, padding: '0 8px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: SUB, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      {c.company_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isAgency ? '1fr' : '1fr 160px', gap: 10, alignItems: 'start' }}>
              <div>
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
                <div>
                  <div style={labelStyle}>분류</div>
                  <select value={existing ? (company?.industry ?? '') : industry} disabled={saving || existing}
                    onChange={e => { setIndustry(e.target.value); clearError('industry') }}
                    style={{
                      ...inputStyle, cursor: 'pointer',
                      ...(errors.industry ? { border: errBorder } : null),
                      ...(existing ? { background: '#f9fafb', color: MUTED } : null),
                    }}>
                    <option value="">분류 선택</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                  <FieldError message={errors.industry} />
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── ③ 사업장 ── */}
        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ ...sectionTitle, marginBottom: 0 }}>{isAgency ? '주소 · 상태' : `사업장 ${sites.length}곳`}</div>
            <span style={{ flex: 1 }} />
            {!isAgency && (
              <button type="button" onClick={() => setSites(prev => [...prev, emptySite()])} disabled={saving}
                style={{ height: 26, padding: '0 10px', borderRadius: 6, border: `1px solid ${BORDER}`, background: '#fff', color: TEXT, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                + 사업장 더 추가
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            {(isAgency ? sites.slice(0, 1) : sites).map((site, i) => (
              <div key={i} style={{ display: 'grid', gap: 10, padding: isAgency ? 0 : 12, border: isAgency ? 'none' : `1px solid ${BORDER}`, borderRadius: 8 }}>
                {!isAgency && (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <b style={{ fontSize: 12, fontWeight: 700, color: SUB }}>사업장 {i + 1}</b>
                    <span style={{ flex: 1 }} />
                    {sites.length > 1 && (
                      <button type="button" onClick={() => setSites(prev => prev.filter((_, n) => n !== i))} disabled={saving}
                        style={{ border: 'none', background: 'none', color: MUTED, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                        삭제
                      </button>
                    )}
                  </div>
                )}

                {!isAgency && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
                    <div>
                      <div style={labelStyle}>사업장명 (선택)</div>
                      <input value={site.siteName} disabled={saving}
                        onChange={e => setSite(i, { siteName: e.target.value })}
                        placeholder="ex) 울산공장 · 비우면 회사명만"
                        style={inputStyle} />
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

                <div>
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

                {isAgency ? (
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
                ) : (
                  <div>
                    <div style={labelStyle}>대리점</div>
                    {/* 자유 입력이 아니라 등록된 대리점에서 고른다. 고르지 않으면 직판이다. */}
                    <AgencyPicker
                      value={site.agencyId}
                      onChange={id => setSite(i, { agencyId: id })}
                      disabled={saving}
                      inputStyle={inputStyle}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── ④ 담당자 ── */}
        {!isAgency && (
          <section style={sectionStyle}>
            <div style={sectionTitle}>고객 담당자 <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>선택 — 나중에 사업장 상세에서도 더할 수 있습니다</span></div>
            <div style={{ display: 'grid', gap: 10 }}>
              {sites.length > 1 && (
                <div>
                  <div style={labelStyle}>어느 사업장의 담당자인가요</div>
                  <select value={contact.siteIndex} disabled={saving}
                    onChange={e => setContact(p => ({ ...p, siteIndex: Number(e.target.value) }))}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    {sites.map((s, i) => (
                      <option key={i} value={i}>{`사업장 ${i + 1}${s.siteName.trim() ? ` · ${s.siteName.trim()}` : ''}`}</option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={labelStyle}>이름</div>
                  <input value={contact.name} disabled={saving}
                    onChange={e => { setContact(p => ({ ...p, name: e.target.value })); clearError('contact_name') }}
                    placeholder="이름" style={errors.contact_name ? { ...inputStyle, border: errBorder } : inputStyle} />
                  <FieldError message={errors.contact_name} />
                </div>
                <div>
                  <div style={labelStyle}>부서</div>
                  <input value={contact.department} disabled={saving}
                    onChange={e => setContact(p => ({ ...p, department: e.target.value }))}
                    placeholder="부서" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={labelStyle}>직책</div>
                  <input value={contact.position} disabled={saving}
                    onChange={e => setContact(p => ({ ...p, position: e.target.value }))}
                    placeholder="직책" style={inputStyle} />
                </div>
                <div>
                  <div style={labelStyle}>전화번호</div>
                  <input value={contact.phone} disabled={saving}
                    onChange={e => setContact(p => ({ ...p, phone: e.target.value }))}
                    placeholder="전화번호" style={inputStyle} />
                </div>
              </div>
            </div>
          </section>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={saving}
            style={{ padding: '10px 15px', background: '#fff', color: SUB, borderRadius: 6, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={() => void handleSave()} disabled={saving}
            style={{ padding: '10px 17px', background: BLUE, color: '#fff', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: saving ? 0.6 : 1 }}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
