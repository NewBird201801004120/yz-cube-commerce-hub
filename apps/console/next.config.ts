import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader:false, experimental:{proxyTimeout:150000,proxyClientMaxBodySize:"32mb"}, async rewrites(){return [{source:'/api/:path*',destination:'http://127.0.0.1:4100/api/:path*'}];} };
export default config;
