import SessionManager from '@/components/common/SessionManager'
import HeaderWrapper from '@/components/common/HeaderWrapper'
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
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className={`antialiased bg-white text-black`}>
        <SessionManager />
        <HeaderWrapper />
        {children}
      </body>
    </html>
  );
}