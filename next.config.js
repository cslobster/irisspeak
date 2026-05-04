/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @xenova/transformers ships large WASM/onnx files — externalize so Next bundles them at runtime instead of compile time.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'sharp': 'commonjs sharp',
        'onnxruntime-node': 'commonjs onnxruntime-node',
      });
    }
    return config;
  },
  // Enable API CORS for the Vite frontend at :4200
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH' },
          { key: 'Access-Control-Allow-Headers', value: 'authorization, content-type, x-request-id, x-context-id' },
          { key: 'Access-Control-Max-Age', value: '600' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
