import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { server: { proxy: { '/api': { target: env.ASAN_API_ORIGIN || 'http://127.0.0.1:8001', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') } } }, define: {
    'import.meta.env.NEXT_PUBLIC_CESIUM_ION_TOKEN': JSON.stringify(env.NEXT_PUBLIC_CESIUM_ION_TOKEN || ''),
    'import.meta.env.NEXT_PUBLIC_CESIUM_IMAGERY_ASSET_ID': JSON.stringify(env.NEXT_PUBLIC_CESIUM_IMAGERY_ASSET_ID || '2'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || '/api'),
  }};
});
