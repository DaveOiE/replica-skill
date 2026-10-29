// Static export: the app is plain files, so anything can serve it (a static host, the shop's mini PC, or the device
// itself in a wrapper) and a service worker can cache all of it for offline use.
/** @type {import('next').NextConfig} */
export default { output: 'export', trailingSlash: true, images: { unoptimized: true }, reactStrictMode: false };
