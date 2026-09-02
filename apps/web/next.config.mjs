/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `@alphaink/shared` è compilato in CommonJS dal workspace: Next lo transpila.
  transpilePackages: ['@alphaink/shared'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'alphaink.net' },
      { protocol: 'https', hostname: 'www.alphaink.net' },
      { protocol: 'https', hostname: 'b2b.alphaink.net' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
