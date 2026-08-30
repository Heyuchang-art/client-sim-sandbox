import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '证券客户行为沙盘 | ClientSim Agent',
  description: '在客户策略触达前，完成行为预演、群体风险识别与合规审查。',
  openGraph: {
    title: '证券客户行为沙盘',
    description: '暴跌行情下的客户群体传播模拟、策略预演与合规审计。',
    images: ['/social-preview.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '证券客户行为沙盘',
    description: '暴跌行情下的客户群体传播模拟、策略预演与合规审计。',
    images: ['/social-preview.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
