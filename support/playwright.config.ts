import { defineConfig,devices } from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',timeout:120000,expect:{timeout:95000},fullyParallel:false,workers:1,
 use:{baseURL:process.env.SUPPORT_URL||'http://127.0.0.1:4173',trace:process.env.SUPPORT_URL?'off':'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
 webServer:process.env.SUPPORT_URL?undefined:{command:'npm run build && npx vite preview --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI}
});
