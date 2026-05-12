import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    alias: {
      vm: fileURLToPath(new URL('./src/shims/vm.js', import.meta.url)),
    },
    dedupe: ['bn.js', '@solana/web3.js'],
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util', 'process'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: {
    'process.env': {},
    'process.version': JSON.stringify('v18.0.0'),
    'process.versions': JSON.stringify({ node: '18.0.0' }),
    global: 'globalThis',
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
    cors: true,
    allowedHosts: true,
  },
})
