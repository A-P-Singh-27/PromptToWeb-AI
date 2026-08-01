import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cursor AI Web Builder - Global AI Agent Dashboard',
  description: 'Build, preview, and download complete web applications powered by Cursor Agent Engine.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-indigo-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
