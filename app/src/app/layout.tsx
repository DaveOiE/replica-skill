import ClientRoot from './client-root';

export const metadata = { title: 'Tillbox', description: 'Point of sale that works without a server.' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// Applied before first paint so there is no flash of the wrong theme or text direction.
const BOOT = `try{var d=document.documentElement,t=localStorage.getItem('tb-theme'),l=localStorage.getItem('tb-lang');if(t==='light'||t==='dark')d.dataset.theme=t;if(l==='ar'){d.lang='ar';d.dir='rtl'}else{d.lang='en';d.dir='ltr'}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: BOOT }} /></head>
      <body><ClientRoot>{children}</ClientRoot></body>
    </html>
  );
}
