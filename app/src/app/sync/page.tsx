'use client';
import dynamic from 'next/dynamic';
export default dynamic(() => import('../../views/sync'), { ssr: false });
