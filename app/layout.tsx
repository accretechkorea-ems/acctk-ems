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
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className={`antialiased bg-white text-black`}>
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