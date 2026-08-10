'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const PAGE_BG = '#f4f5f7'
const PANEL_BG = '#ffffff'
const INPUT_BORDER = '#e2e4e9'
const TEXT_PRIMARY = '#111113'
const TEXT_SECONDARY = '#4b5563'
const BLUE_BG = '#234ea2'
const BLUE_TEXT = '#ffffff'
const DANGER_BG = '#dc2626'

type Engineer = {
  engineer_id: number
  name: string
  position: string | null
  email: string | null
}

export default function AccountPage() {
  const supabase = createClient()
  const router = useRouter()

  const [engineer, setEngineer] = useState<Engineer | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [initials, setInitials] = useState('')
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null)
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null)
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
      const { data: userData } = await supabase.auth.getUser()
      const userEmail = userData.user?.email ?? ''
      setEmail(userEmail)

      const { data: engineerData } = await supabase
        .from('engineers')
        .select('*')
        .eq('email', userEmail)
        .single()

      if (engineerData) {
        setEngineer(engineerData)
        setName(engineerData.name ?? '')
        setInitials(engineerData.initials ?? '')
        setProfileImageUrl(engineerData.profile_image_url ?? null)
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

    let imageUrl = profileImageUrl

    // 프로필 사진 업로드
    if (profileImageFile) {
      const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      if (!ALLOWED_IMAGE_TYPES.includes(profileImageFile.type)) {
        setProfileMessage({ type: 'error', text: 'JPG, PNG, WEBP, GIF 형식의 이미지만 업로드 가능합니다.' })
        setIsSavingProfile(false)
        return
      }
      if (profileImageFile.size > 5 * 1024 * 1024) {
        setProfileMessage({ type: 'error', text: '파일 크기는 5MB 이하여야 합니다.' })
        setIsSavingProfile(false)
        return
      }
      const fileExt = profileImageFile.name.split('.').pop()
      const fileName = `profile-${engineer.engineer_id}-${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(fileName, profileImageFile, { upsert: true })

      if (uploadError) {
        setProfileMessage({ type: 'error', text: '사진 업로드 중 오류가 발생했습니다.' })
        setIsSavingProfile(false)
        return
      }

      const { data } = supabase.storage.from('profile-images').getPublicUrl(fileName)
      imageUrl = data.publicUrl
    }

    const { error } = await supabase
      .from('engineers')
      .update({
  name: name.trim(),
  initials: initials.trim().toUpperCase() || null,
  profile_image_url: imageUrl,
})
      .eq('engineer_id', engineer.engineer_id)

    setIsSavingProfile(false)

    if (error) {
      setProfileMessage({ type: 'error', text: '저장 중 오류가 발생했습니다.' })
      return
    }

    setProfileImageUrl(imageUrl)
    setProfileImageFile(null)
    setProfileMessage({ type: 'success', text: '프로필이 저장되었습니다.' })
  }

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
              width: 72, height: 72, borderRadius: '50%',
              background: '#234ea2', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {profileImageUrl ? (
                <img src={profileImageUrl} alt="프로필" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                  if (file) setProfileImageUrl(URL.createObjectURL(file))
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