import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'ethers': ['ethers'],
          'walletconnect': ['@walletconnect/ethereum-provider', '@walletconnect/modal']
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
})