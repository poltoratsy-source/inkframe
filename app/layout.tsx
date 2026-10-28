import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Inkframe',
  description: 'An open studio for hand-painted cartoons, written and drawn by Claude.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
