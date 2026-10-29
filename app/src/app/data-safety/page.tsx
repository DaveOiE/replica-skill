'use client';
import dynamic from 'next/dynamic';
export default dynamic(() => import('../../views/data-safety'), { ssr: false });
