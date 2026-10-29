'use client';
import dynamic from 'next/dynamic';
export default dynamic(() => import('../../views/bench'), { ssr: false });
