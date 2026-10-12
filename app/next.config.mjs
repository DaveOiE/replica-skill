// Static export: the app is plain files, so it can be served by anything (or by the device itself) and cached offline.
/** @type {import('next').NextConfig} */
export default { output: 'export', images: { unoptimized: true }, reactStrictMode: false };
