/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Static export. Every page is pre-rendered to HTML at build time and
  // served as flat files. No server is required at runtime — works on
  // Netlify, Vercel, Cloudflare Pages, GitHub Pages, S3+CloudFront, etc.
  // The dashboard fetches its county/tract/votes data from /data/* (also
  // static files) and runs the ReCom Markov chain entirely client-side.
  output: 'export',

  // Clean URLs (no .html on the wire). Both Netlify and Vercel honor this.
  trailingSlash: false,

  // No image-optimizer in static export.
  images: { unoptimized: true },
};
export default nextConfig;
