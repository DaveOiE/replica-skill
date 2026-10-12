'use client';
import dynamic from 'next/dynamic';
// The database only exists in the browser, so the screen is never rendered on a server.
const Spike = dynamic(() => import('./spike'), { ssr: false, loading: () => <p>Opening local database…</p> });
export default function Page() { return <Spike />; }
