import type { NextConfig } from "next";

// Define the Security Policy
// Updated to whitelist Alchemy, WalletConnect, Coinbase, and Public RPCs.
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live;
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://ipfs.io https://*.pinata.cloud https://api.web3modal.org https://walletconnect.org https://secure.walletconnect.org;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    connect-src 'self' 
      https://*.supabase.co 
      https://*.supabase.in
      https://api.pinata.cloud 
      https://gateway.pinata.cloud 
      https://sepolia.optimism.io 
      https://rpc.sepolia.org
      https://*.walletconnect.com 
      wss://*.walletconnect.org
      https://eth.merkle.io 
      https://eth-mainnet.g.alchemy.com 
      https://api.web3modal.org 
      https://pulse.walletconnect.org 
      https://cca-lite.coinbase.com 
      https://rpc.walletconnect.com
      wss://relay.walletconnect.com
      wss://www.walletlink.org;
    upgrade-insecure-requests;
`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // devIndicators: false, // Commented out as it sometimes causes type errors in newer Next versions
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  // SECURITY: Inject CSP Headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader.replace(/\n/g, ""), // Remove newlines for the header value
          },
          // Prevent clickjacking
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          // Prevent MIME sniffing
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/_health/:path*",
        destination: "/api/health/:path*",
      },
    ];
  },
  webpack: config => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

const isIpfs = process.env.NEXT_PUBLIC_IPFS_BUILD === "true";

if (isIpfs) {
  nextConfig.output = "export";
  nextConfig.trailingSlash = true;
  nextConfig.images = {
    unoptimized: true,
  };
}

module.exports = nextConfig;
