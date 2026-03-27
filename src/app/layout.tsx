import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PainRadar",
  description:
    "PainRadar는 Reddit 서브레딧에서 반복되는 불편과 문제 신호를 수집·분석해 스타트업 아이디어를 발굴하는 대시보드입니다.",
  applicationName: "PainRadar",
  openGraph: {
    title: "PainRadar",
    description:
      "Reddit의 반복 불편 신호를 추적해 검증 가능한 스타트업 문제를 찾는 대시보드",
    type: "website",
    siteName: "PainRadar",
  },
  twitter: {
    card: "summary_large_image",
    title: "PainRadar",
    description:
      "Reddit 불편 신호를 수집·분석해 스타트업 문제를 빠르게 탐색합니다.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
