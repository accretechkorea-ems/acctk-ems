'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadMe } from '@/lib/appData/me'
import { useMe } from '@/lib/appData/MeProvider'
import { useAvatarUrl } from '@/hooks/useAvatarUrl'
import {
  PROFILE_BUCKET, PROFILE_IMAGE_MAX_BYTES, PROFILE_IMAGE_TYPES, profileImageFileName,
} from '@/lib/profileImage'
import { useRouter } from 'next/navigation'
import { INITIALS_TAKEN_MESSAGE, isInitialsTaken, isInitialsUniqueViolation, normalizeInitials } from '@/lib/initials'
import AddressField from '@/components/customer/modals/AddressField'
import { geocodeAddress } from '@/lib/geocode'

const PAGE_BG = '#f4f5f7'
const PANEL_BG = '#ffffff'
const INPUT_BORDER = '#e2e4e9'
const TEXT_PRIMARY = '#111113'
const TEXT_SECONDARY = '#4b5563'
const BLUE_BG = '#234ea2'
const BLUE_TEXT = '#ffffff'
const DANGER_BG = '#dc2626'
/** 프로필 사진 지름. 받아 올 변환 폭을 이 값으로 정한다(lib/profileImage.ts). */
const AVATAR_SIZE = 72

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  email: string | null
  tel: string | null
}

export default function AccountPage() {
  const supabase = createClient()
  const router = useRouter()
  /**
   * 저장 뒤 **Provider 까지** 다시 읽는다.
   *
   * 예전에는 invalidateMe()·invalidateEngineers() 만 불렀다. 그 둘은 모듈 캐시를 버리는
   * 일이라, 같은 레이아웃 안에서 화면만 옮기면(내 정보 → 고객사 현황) Provider 가 들고 있는
   * me 는 **옛 값 그대로**였다. 자택 주소를 지워도 지도의 「자택」이 그대로 살아 있었다.
   * refresh() 는 캐시를 버리고 다시 읽어 Provider 상태까지 갈아 준다(MeProvider).
   */
  const { refresh: refreshMe } = useMe()

  const [engineer, setEngineer] = useState<Engineer | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [initials, setInitials] = useState('')
  const [tel, setTel] = useState('')   // 전화번호(선택)
  /**
   * 자택 주소(선택). 고객사 지도의 「자택 출발」에만 쓴다.
   *
   * 좌표(home_lat·home_lng)는 저장할 때 이 주소를 지오코딩해 함께 넣는다 — 업체 등록과
   * 같은 경로다(lib/geocode.ts). 주소가 그대로면 다시 변환하지 않는다(카카오 호출 한 번과
   * 7초 대기를 아낀다). 비우고 저장하면 세 칸 모두 null 이 된다.
   *
   * **남에게 보이지 않는다** — 직원 목록·관리자 화면의 조회 열에 이 칸이 없다.
   */
  const [homeAddress, setHomeAddress] = useState('')
  /** 불러온 값 — 주소가 바뀌었는지 가늠해 지오코딩 여부를 정한다. */
  const [savedHome, setSavedHome] = useState<{ address: string; lat: number | null; lng: number | null }>(
    { address: '', lat: null, lng: null },
  )
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null)
  /** DB 에 저장된 값 — **버킷 안의 경로**다(옛 행은 공개 URL 일 수 있다). */
  const [profileImagePathValue, setProfileImagePathValue] = useState<string | null>(null)
  /** 방금 고른 파일의 미리보기(blob:). 저장 전까지만 쓴다. */
  const [pickedPreview, setPickedPreview] = useState<string | null>(null)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSavingPassword, setIsSavingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const inputStyle = {
    width: '100%',
    padding: 12,
    border: `1px solid ${INPUT_BORDER}`,
    borderRadius: 10,
    background: PAGE_BG,
    color: TEXT_PRIMARY,
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontSize: 15,
  }

  useEffect(() => {
    const fetchProfile = async () => {
      // 세션은 공통 층에서(조회 0회). 자기 행은 편집 칸(이니셜·프로필 사진)까지 필요해
      // 여기서 그대로 읽는다 — 저장 직후 다시 읽어야 하는 화면이다.
      const { email: userEmail } = await loadMe()
      setEmail(userEmail ?? '')

      const { data: engineerData } = await supabase
        .from('engineers')
        .select('*')
        .eq('email', userEmail ?? '')
        .maybeSingle()

      if (engineerData) {
        setEngineer(engineerData)
        setName(engineerData.name ?? '')
        setInitials(engineerData.initials ?? '')
        setTel(engineerData.tel ?? '')
        setHomeAddress(engineerData.home_address ?? '')
        setSavedHome({
          address: engineerData.home_address ?? '',
          lat: engineerData.home_lat == null ? null : Number(engineerData.home_lat),
          lng: engineerData.home_lng == null ? null : Number(engineerData.home_lng),
        })
        setProfileImagePathValue(engineerData.profile_image_url ?? null)
      }
    }

    fetchProfile()
  }, [])

  const handleSaveProfile = async () => {
    if (!engineer) return
    if (!name.trim()) {
      setProfileMessage({ type: 'error', text: '이름을 입력해주세요.' })
      return
    }

    setIsSavingProfile(true)
    setProfileMessage(null)

    // 본인 페이지도 이니셜을 고칠 수 있는 자리다 — 관리자 화면과 같은 규칙으로 막는다.
    // (여기는 라우트를 거치지 않고 사용자 클라이언트로 바로 저장하므로 검사도 여기서 한다.
    //  재직자만 세고, 자기 자신은 뺀다. 최종 판정은 아래 update 의 23505 처리다.)
    if (initials.trim()) {
      const { data: peers, error: peerErr } = await supabase
        .from('engineers')
        .select('engineer_id, initials, resigned_date')
        .eq('initials', normalizeInitials(initials))
      if (peerErr) console.error('[account] 이니셜 조회 실패', peerErr)
      if (isInitialsTaken(peers, initials, engineer.engineer_id)) {
        setProfileMessage({ type: 'error', text: INITIALS_TAKEN_MESSAGE })
        setIsSavingProfile(false)
        return
      }
    }

    // 프로필 사진 — 저장하는 값은 **버킷 안의 경로**다.
    //
    // 예전에는 getPublicUrl() 로 만든 공개 주소를 넣었는데, 이 버킷은 비공개라 그 주소는
    // 열리지 않는다(2026-10-23 확인: HTTP 400 — 사진이 늘 깨져 있었다). 보여 줄 때는
    // /api/profile-image 가 서명 URL 을 준다(lib/profileImage.ts).
    let imagePath = profileImagePathValue

    if (profileImageFile) {
      if (!(PROFILE_IMAGE_TYPES as readonly string[]).includes(profileImageFile.type)) {
        setProfileMessage({ type: 'error', text: 'JPG, PNG, WEBP, GIF 형식의 이미지만 업로드 가능합니다.' })
        setIsSavingProfile(false)
        return
      }
      if (profileImageFile.size > PROFILE_IMAGE_MAX_BYTES) {
        setProfileMessage({ type: 'error', text: '파일 크기는 5MB 이하여야 합니다.' })
        setIsSavingProfile(false)
        return
      }
      const fileName = profileImageFileName(engineer.engineer_id, profileImageFile.name, Date.now())

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_BUCKET)
        .upload(fileName, profileImageFile, { upsert: true })

      if (uploadError) {
        console.error('[account] 사진 업로드 실패', uploadError)
        setProfileMessage({ type: 'error', text: '사진 업로드 중 오류가 발생했습니다.' })
        setIsSavingProfile(false)
        return
      }

      imagePath = fileName
    }

    // ── 자택 주소 → 좌표 ────────────────────────────────────────────────
    // 비웠으면 세 칸 모두 null. 주소가 그대로면 가진 좌표를 그대로 둔다(다시 변환하지 않는다).
    // 새 주소면 지오코딩한다 — 실패하면 **주소는 저장하고 좌표만 비운다**. 주소 자체는
    // 쓸모가 있고(사람이 읽는다), 좌표가 없으면 지도의 「자택 출발」이 흐리게 남는다.
    const home = homeAddress.trim()
    let homeLat = savedHome.lat
    let homeLng = savedHome.lng
    let geoFailed = false
    if (!home) {
      homeLat = null
      homeLng = null
    } else if (home !== savedHome.address || homeLat == null || homeLng == null) {
      try {
        const coords = await geocodeAddress(home)
        homeLat = coords.latitude
        homeLng = coords.longitude
      } catch (e) {
        console.error('[account] 자택 주소 좌표 변환 실패', e)
        homeLat = null
        homeLng = null
        geoFailed = true
      }
    }

    const { error } = await supabase
      .from('engineers')
      .update({
  name: name.trim(),
  initials: initials.trim().toUpperCase() || null,
  tel: tel.trim() || null,   // 선택 입력, 검증 없음
  profile_image_url: imagePath,
  home_address: home || null,
  home_lat: homeLat,
  home_lng: homeLng,
})
      .eq('engineer_id', engineer.engineer_id)

    setIsSavingProfile(false)

    if (error) {
      console.error('[account] 프로필 저장 실패', error)
      setProfileMessage({
        type: 'error',
        text: isInitialsUniqueViolation(error) ? INITIALS_TAKEN_MESSAGE : '저장 중 오류가 발생했습니다.',
      })
      return
    }

    setSavedHome({ address: home, lat: homeLat, lng: homeLng })
    // 새 경로를 넣으면 아래 useAvatarUrl 이 그 경로의 서명 URL 을 받아 **바로** 그린다.
    setProfileImagePathValue(imagePath)
    setProfileImageFile(null)
    if (pickedPreview) { URL.revokeObjectURL(pickedPreview); setPickedPreview(null) }
    // 이름·이니셜·사진·자택이 바뀌었다 — 공통 캐시를 버려 사이드바·지도가 새 값을 읽게 한다.
    // (refresh() 가 engineers 목록 캐시까지 함께 버린다 — MeProvider)
    await refreshMe()
    setProfileMessage(geoFailed
      // 저장은 됐다. 다만 지도에서 「자택 출발」을 쓸 수 없다는 사실을 알려 준다.
      ? { type: 'error', text: '저장했지만 자택 주소의 좌표를 찾지 못했습니다. 지도의 「자택 출발」은 쓸 수 없습니다 — 주소를 다시 검색해 보세요.' }
      : { type: 'success', text: '프로필이 저장되었습니다.' })
  }

  // 프로필 사진 — 버킷이 비공개라 서명 URL 을 받아 그린다(hooks/useAvatarUrl.ts).
  // 고른 파일이 있으면 그 미리보기가 먼저다 — 저장 전에도 바뀐 사진이 보인다.
  const { url: avatarUrl } = useAvatarUrl(profileImagePathValue, AVATAR_SIZE)
  const shownAvatar = pickedPreview ?? avatarUrl

  const handleChangePassword = async () => {
    setPasswordMessage(null)

    if (!currentPassword.trim()) {
      setPasswordMessage({ type: 'error', text: '현재 비밀번호를 입력해주세요.' })
      return
    }
    if (!newPassword.trim()) {
      setPasswordMessage({ type: 'error', text: '새 비밀번호를 입력해주세요.' })
      return
    }
    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: '새 비밀번호는 6자 이상이어야 합니다.' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' })
      return
    }

    setIsSavingPassword(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })

    if (signInError) {
      setPasswordMessage({ type: 'error', text: '현재 비밀번호가 올바르지 않습니다.' })
      setIsSavingPassword(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setIsSavingPassword(false)

    if (error) {
      setPasswordMessage({ type: 'error', text: '비밀번호 변경 중 오류가 발생했습니다.' })
      return
    }

    setPasswordMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' })
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  const MessageBox = ({ message }: { message: { type: 'success' | 'error'; text: string } | null }) => {
    if (!message) return null
    return (
      <div style={{
        marginTop: 16, padding: '12px 16px', borderRadius: 10,
        background: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
        color: message.type === 'success' ? '#166534' : DANGER_BG,
        fontSize: 14, fontWeight: 600,
      }}>
        {message.text}
      </div>
    )
  }

  return (
    <main style={{ padding: 24, background: PAGE_BG, minHeight: '100vh' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: TEXT_PRIMARY, padding: 0 }}
          >
            ←
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: TEXT_PRIMARY, margin: 0 }}>정보 수정</h1>
        </div>

        {/* 프로필 카드 */}
        <div style={{ background: PANEL_BG, border: `1px solid ${INPUT_BORDER}`, borderRadius: 16, padding: 24, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 20px 0' }}>프로필</h2>

          {/* 프로필 사진 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{
              width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: '50%',
              background: '#234ea2', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {shownAvatar ? (
                /* eslint-disable-next-line @next/next/no-img-element -- Supabase 서명 URL 이라 next/image 최적화가 걸리지 않는다 */
                <img src={shownAvatar} alt="프로필" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>
                  {name?.[0]?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>프로필 사진</div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  setProfileImageFile(file)
                  // 고른 파일은 blob: 주소로 먼저 보여 준다(올리기 전이다).
                  setPickedPreview(prev => {
                    if (prev) URL.revokeObjectURL(prev)
                    return file ? URL.createObjectURL(file) : null
                  })
                }}
                style={{ fontSize: 13, color: TEXT_PRIMARY }}
              />
            </div>
          </div>

         {/* 이름 / 이니셜 (직책은 관리자 페이지에서만 관리) */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>이름</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                style={inputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>이니셜</div>
              <input
                value={initials}
                onChange={(e) => setInitials(e.target.value.toUpperCase())}
                placeholder="KJW"
                maxLength={5}
                style={inputStyle}
              />
            </div>
          </div>

          {/* 전화번호 (선택 입력) */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>전화번호</div>
            <input
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              placeholder="010-1234-5678"
              style={inputStyle}
            />
          </div>

          {/* 자택 주소 (선택) — 업체 등록과 같은 카카오 우편번호 검색 + 상세주소.
              고객사 지도의 「자택 출발」에만 쓰이고 다른 사람에게는 보이지 않는다. */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>
              자택 주소 <span style={{ color: '#9ca3af' }}>(선택 · 고객사 지도의 「자택 출발」에 쓰입니다)</span>
            </div>
            <AddressField
              value={homeAddress}
              onChange={setHomeAddress}
              inputStyle={inputStyle}
              errorBorder={DANGER_BG}
              // 선택 칸이라 지울 길이 있어야 한다 — 값이 있을 때만 × 가 나온다.
              clearable
            />
            {homeAddress.trim() && savedHome.address === homeAddress.trim() && savedHome.lat == null && (
              <div style={{ fontSize: 12, color: DANGER_BG, marginTop: 6 }}>
                좌표를 찾지 못한 주소입니다 — 지도의 「자택 출발」은 쓸 수 없습니다.
              </div>
            )}
            {homeAddress.trim() === '' && savedHome.address !== '' && (
              <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 6 }}>
                비운 채 <b>프로필 저장</b>을 누르면 등록된 자택 주소가 지워집니다(지도의 「자택 출발」도 꺼집니다).
              </div>
            )}
          </div>

          {/* 이메일 (수정 불가) */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>이메일</div>
            <input
              value={email}
              disabled
              style={{ ...inputStyle, background: '#f0f0f0', color: TEXT_SECONDARY }}
            />
          </div>

          <MessageBox message={profileMessage} />

          <button
            onClick={handleSaveProfile}
            disabled={isSavingProfile}
            style={{
              width: '100%', marginTop: 20, padding: '12px 0',
              background: BLUE_BG, color: BLUE_TEXT, border: 'none',
              borderRadius: 10, fontWeight: 700, fontSize: 15,
              cursor: 'pointer', opacity: isSavingProfile ? 0.7 : 1,
            }}
          >
            {isSavingProfile ? '저장 중...' : '프로필 저장'}
          </button>
        </div>

        {/* 비밀번호 카드 */}
        <div style={{ background: PANEL_BG, border: `1px solid ${INPUT_BORDER}`, borderRadius: 16, padding: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT_PRIMARY, margin: '0 0 16px 0' }}>비밀번호 변경</h2>

          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>현재 비밀번호</div>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="현재 비밀번호 입력" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>새 비밀번호</div>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="새 비밀번호 입력 (6자 이상)" style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: TEXT_SECONDARY, marginBottom: 6 }}>새 비밀번호 확인</div>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="새 비밀번호 다시 입력" style={inputStyle} />
            </div>
          </div>

          <MessageBox message={passwordMessage} />

          <button
            onClick={handleChangePassword}
            disabled={isSavingPassword}
            style={{
              width: '100%', marginTop: 20, padding: '12px 0',
              background: BLUE_BG, color: BLUE_TEXT, border: 'none',
              borderRadius: 10, fontWeight: 700, fontSize: 15,
              cursor: 'pointer', opacity: isSavingPassword ? 0.7 : 1,
            }}
          >
            {isSavingPassword ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>
      </div>
    </main>
  )
}