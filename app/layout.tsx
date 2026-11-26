import SessionManager from '@/components/common/SessionManager'
import { MeProvider } from '@/lib/appData/MeProvider'
import HeaderWrapper from '@/components/common/HeaderWrapper'
import { ToastProvider } from '@/components/common/Toast'
import PdfViewerHost from '@/components/pdf/PdfViewerHost'
import { ConfirmProvider } from '@/components/common/ConfirmDialog'
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACCRETECH KOREA",
  description: "ACCRETECH 고객사 현황 시스템",
};

/**
 * 화면 맞춤 — **노치 기기의 안전 영역을 쓰려고** viewport-fit=cover 를 켠다(2026-11-25).
 *
 * 켜지 않으면 iOS 가 상태바·홈바 자리를 알아서 비워 주는 대신 env(safe-area-inset-*) 이
 * 전부 0 이 된다. 그러면 이미 넣어 둔 아래쪽 여백(홈바)도 아무 일을 하지 않는다.
 * 켠 뒤에는 **우리가** 비운다 — 앱바는 위쪽 안전 영역만큼 내려 깔고(components/layout/Sidebar),
 * 고정 하단 바·모달은 아래쪽만큼 띄운다(app/globals.css).
 */
/**
 * **최대 배율 1** — iOS 의 자동 확대를 막는다 (2026-11-26).
 *
 * /debug/viewport 실측(iOS 18.7·26, Safari): `visualViewport.scale 1.15` · `innerWidth 350` ·
 * 넘친 요소 0. 즉 **잘린 것이 아니라 확대된 것**이었다 — iOS 는 글자가 16px 미만인 입력칸에
 * 포커스가 가면 화면을 제 맘대로 키우고, 그 뒤로 오른쪽이 잘린 채 남는다(되돌려 주지 않는다).
 *
 * `user-scalable=no` 는 쓰지 않는다 — 두 손가락 확대까지 막으면 글자를 키워 보는 길이 사라진다
 * (접근성). `maximum-scale=1` 은 **자동 확대만** 막고 사용자가 직접 하는 확대는 iOS 17+ 에서
 * 그대로 된다. 짝이 되는 규칙은 app/globals.css 의 「폰 입력칸은 16px」이다 — 둘 중 하나만
 * 두면 자동 확대가 그대로 남거나(16px 규칙만), 확대된 자리로 끌려간다(maximum-scale 만).
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      {/* bg-white 를 걷었다(2026-11-26) — 내용이 화면보다 짧을 때 아래에 흰 띠가 드러났다.
          바탕은 app/globals.css 의 `body { background }`(페이지 배경)가 정한다. */}
      <body className={`antialiased text-black`}>
        {/* 본인 정보(세션 + engineers + 팀 권한)를 **여기서 한 번** 읽어 아래로 내린다.
            화면·훅은 useMe() 로 받는다 — docs/perf-rules.md 1. */}
        <MeProvider>
        <ToastProvider>
          <ConfirmProvider>
            {/* 자동 로그아웃 감시 — **provider 안쪽**이다. 1분 전 경고를 모달로 띄우므로
                (종전에는 alert 이었다) 토스트·확인창을 쓸 수 있는 자리에 있어야 한다. */}
            <SessionManager />
            {/* PDF 모달 뷰어 — 화면 밖(모듈 함수)에서도 부르므로 뿌리에 하나 꽂아 둔다. */}
            <PdfViewerHost />
            {/* 좌측 사이드바 + 본문. 공개 경로에서는 본문만 그대로 내보낸다. */}
            <HeaderWrapper>{children}</HeaderWrapper>
          </ConfirmProvider>
        </ToastProvider>
        </MeProvider>
      </body>
    </html>
  );
}