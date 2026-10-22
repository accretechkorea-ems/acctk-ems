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
        <SessionManager />
        {/* 본인 정보(세션 + engineers + 팀 권한)를 **여기서 한 번** 읽어 아래로 내린다.
            화면·훅은 useMe() 로 받는다 — docs/perf-rules.md 1. */}
        <MeProvider>
        <ToastProvider>
          <ConfirmProvider>
            {/* 좌측 사이드바 + 본문. 공개 경로에서는 본문만 그대로 내보낸다. */}
            <HeaderWrapper>{children}</HeaderWrapper>
          </ConfirmProvider>
        </ToastProvider>
        </MeProvider>
      </body>
    </html>
  );
}