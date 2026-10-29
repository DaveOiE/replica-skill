'use client';
import dynamic from 'next/dynamic';
// The database exists only in the browser, so none of the app is rendered on a server.
const Root = dynamic(() => import('../client/root'), { ssr: false, loading: () => <p style={{ padding: 16 }}>…</p> });
export default function ClientRoot({ children }: { children: React.ReactNode }) { return <Root>{children}</Root>; }
