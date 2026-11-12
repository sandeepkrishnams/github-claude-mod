import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at https://sandeepkrishnams.github.io/github-claude-mod/
export default defineConfig({
  base: '/github-claude-mod/',
  plugins: [react()]
});
