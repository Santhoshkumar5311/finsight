import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'FinSight — A little clarity. A better tomorrow.',
  description: 'Your personal finance diary. Make sense of your money, one day at a time.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
