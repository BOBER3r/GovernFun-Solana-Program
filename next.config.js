/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Fixes npm packages that depend on `crypto` module
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      assert: require.resolve('assert'),
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      os: require.resolve('os-browserify'),
      url: require.resolve('url')
    };
    return config;
  },
  reactStrictMode: true,
};

module.exports = nextConfig;