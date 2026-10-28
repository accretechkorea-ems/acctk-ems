import SessionManager from '@/components/common/SessionManager'
import { MeProvider } from '@/lib/appData/MeProvider'
import HeaderWrapper from '@/components/common/HeaderWrapper'
import { ToastProvider } from '@/components/common/Toast'
import { ConfirmProvider } from '@/components/common/ConfirmDialog'
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACCRETECH KOREA",
  description: "ACCRETECH 고객사 현황 시스템",
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
            {/* 좌측 사이드바 + 본문. 공개 경로에서는 본문만 그대로 내보낸다. */}
            <HeaderWrapper>{children}</HeaderWrapper>
          </ConfirmProvider>
        </ToastProvider>
        </MeProvider>
      </body>
    </html>
  );
}