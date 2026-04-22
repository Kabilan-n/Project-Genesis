import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Project Genesis',
  description: 'Watch an autonomous AI civilization write itself.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const worldId = process.env.NEXT_PUBLIC_WORLD_ID || '';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

  return (
    <html lang="en">
      <body>
        <script dangerouslySetInnerHTML={{ __html: `window.__genesis=${JSON.stringify({worldId,apiUrl,wsUrl})}` }} />
        {children}
      </body>
    </html>
  );
}
