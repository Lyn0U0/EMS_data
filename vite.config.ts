import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ base: '/EMS_data/', plugins: [tailwindcss()] });
