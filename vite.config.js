import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Replace 'legislative-radar' with your actual GitHub repo name
  base: '/legislative-radar/',
})
