import SessionManager from '@/components/common/SessionManager'
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
        <ToastProvider>
          <ConfirmProvider>
            {/* 좌측 사이드바 + 본문. 공개 경로에서는 본문만 그대로 내보낸다. */}
            <HeaderWrapper>{children}</HeaderWrapper>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}