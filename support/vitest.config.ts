import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { corpus,indexStatements } from './scripts/corpus';
export default defineConfig(async()=>({
 plugins:[cloudflareTest({main:'./src/worker.ts',remoteBindings:false,miniflare:{
  compatibilityDate:'2026-10-12',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],
  bindings:{MCP_INTERNAL_SECRET:'test-internal-secret-at-least-32-characters',DEEPSEEK_API_KEY:'test-only',DEEPSEEK_MODEL:'test',ALLOW_INSECURE_LOCAL:'true',TEST_MIGRATIONS:await readD1Migrations('migrations'),TEST_INDEX:indexStatements(await corpus('../knowledge/support'))}
 }})],
 test:{include:['tests/**/*.test.ts'],testTimeout:20000,hookTimeout:30000,fileParallelism:false}
}));
