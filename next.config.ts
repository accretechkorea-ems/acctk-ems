import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Supabase API + Storage + Realtime + 한국수출입은행 환율 API + 폰트 다운로드
      // + Kakao Maps 좌표변환(Geocoder/Places)·지도 타일 요청
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://oapi.koreaexim.go.kr https://fonts.gstatic.com https://dapi.kakao.com https://*.daumcdn.net https://*.kakao.com http://dapi.kakao.com http://*.daumcdn.net",
      // Kakao Maps SDK
      // (카카오 SDK는 내부적으로 t1.daumcdn.net의 kakao.js를 로드하는데,
      //  로컬(http) 환경에서는 http로 불러오므로 http 스킴도 허용한다.)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://dapi.kakao.com https://t1.daumcdn.net http://t1.daumcdn.net http://dapi.kakao.com",
      // Google Fonts
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      // 이미지: Supabase Storage, Kakao, data URI, blob
      "img-src 'self' data: blob: https://*.supabase.co https://*.daumcdn.net https://*.kakaocdn.net http://*.daumcdn.net http://*.kakaocdn.net",
      // @react-pdf/renderer PDFViewer는 blob: URL iframe으로 렌더링
      // + 카카오 우편번호 검색(postcode.map.kakao.com)
      //   우편번호 스크립트는 about:blank 프레임을 만들고 그 안에 postcode.map.kakao.com/search 를
      //   iframe 으로 넣는다. about:blank 는 부모의 CSP 를 물려받으므로 이 호스트가 frame-src 에
      //   없으면 「이 콘텐츠는 차단되었습니다」로 막힌다(팝업·embed 둘 다 같은 구조다).
      //   로컬(http://localhost) 개발에서는 스크립트가 http 로 붙을 수 있어 http 스킴도 허용한다
      //   (위 script-src 의 t1.daumcdn.net 을 http·https 둘 다 넣어둔 것과 같은 이유).
      "frame-src 'self' blob: https://postcode.map.kakao.com http://postcode.map.kakao.com",
      // @react-pdf/renderer Web Worker (PDF 렌더링 스레드)
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  async redirects() {
    return [
      // 옛 통합 요청함(/requests) — 화면과 라우트를 지웠다(전자결재 8단계). 쇼룸 사용 신청(4단계)과
      // 견적 삭제 요청(5단계)이 모두 결재로 옮겨져 새로 들어올 건이 없다.
      //
      // 주소는 받아 준다 — 옛 알림·즐겨찾기·북마크가 404 가 되지 않게 결재함으로 보낸다.
      // permanent: false(307) 로 둔 이유는 /showroom/usage 리다이렉트와 같다 — 브라우저가 이 이동을
      // 영구히 기억하면 나중에 /requests 를 다시 쓸 때 캐시에 갇힌다.
      //
      // 하위 경로도 함께 받는다. 실제로 있던 하위 화면은 없지만, 쿼리가 붙은 옛 링크
      // (/requests?status=대기 등)와 혹시 손으로 더 붙인 주소를 한곳에서 흡수한다.
      { source: '/requests', destination: '/approval', permanent: false },
      { source: '/requests/:path*', destination: '/approval', permanent: false },
    ]
  },
}

export default nextConfig
