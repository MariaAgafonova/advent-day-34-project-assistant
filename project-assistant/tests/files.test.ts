import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { connectFiles, type FilesClient } from '../src/mcp.js';
import { applyRun, Store } from '../src/store.js';
import { Policy } from '../src/policy.js';
import { hash, LIMITS } from '../src/common.js';
import { fixture } from './helpers.js';

const clients:FilesClient[]=[],repos:string[]=[];
afterEach(async()=>{for(const c of clients.splice(0))await c.close();for(const r of repos.splice(0))await fs.rm(r,{recursive:true,force:true});});
async function setup(edit?:(r:string)=>Promise<void>){const repo=await fixture();repos.push(repo);await edit?.(repo);const client=await connectFiles(repo,'test-run');clients.push(client);return {repo,client};}
async function stage(client:FilesClient,p:string,content:string){
  const source=(await client.call('read_file',{path:'src/schemas.ts'})).data as any;
  let original:string|null=null;const read=await client.call('read_file',{path:p});if(!read.isError)original=String(read.data.sha256);
  return client.call('stage_file_change',{path:p,content,expected_hash:original,explanation:'Verified documentation change',sources:[{path:source.path,start_line:1,end_line:source.lines.at(-1).number,sha256:source.sha256}]});
}
describe('real MCP stdio files',()=>{
  it('initializes and exposes only five tools; searches several files and reads exact ranges',async()=>{
    const {client}=await setup();expect(client.tools.map(t=>t.name).sort()).toEqual(['list_files','preview_changes','read_file','search_text','stage_file_change']);
    const search=await client.call('search_text',{query:'validateMessage'});expect(search.isError).toBe(false);expect(new Set((search.data.matches as any[]).map(m=>m.path)).size).toBe(2);
    const read=await client.call('read_file',{path:'src/schemas.ts',start_line:2,end_line:3});expect(read.data.lines).toHaveLength(2);expect((read.data.lines as any[])[0].number).toBe(2);expect(read.data.sha256).toMatch(/^[a-f0-9]{64}$/);
    const page=await client.call('list_files',{limit:1});expect(page.data.truncated).toBe(true);expect(page.data.next_offset).toBe(1);
    expect((await client.call('list_files',{directory:'.'})).isError).toBe(false);
    expect((await client.call('search_text',{query:'hello',directory:'src/routes.ts'})).data.code).toBe('not_directory');
    expect((await client.call('search_text',{query:'-not-an-option'})).isError).toBe(false);
  });
  it('enforces filters, literal search, limits, truncation and invalid ranges',async()=>{
    const {client}=await setup(async r=>{await fs.writeFile(path.join(r,'docs/large.md'),'match literal.*\n'.repeat(2500));await fs.writeFile(path.join(r,'docs/oversize.md'),'x'.repeat(LIMITS.fileBytes+1));});
    const list=await client.call('list_files',{directory:'src',extensions:['.ts']});expect(list.data.files).toHaveLength(3);
    const s=await client.call('search_text',{query:'literal.*',limit:2});expect(s.data.matches).toHaveLength(2);expect(s.data.truncated).toBe(true);
    const r=await client.call('read_file',{path:'docs/large.md',end_line:2500});expect(r.data.truncated).toBe(true);expect(r.data.next_line).toBeGreaterThan(1);
    expect((await client.call('read_file',{path:'docs/oversize.md'})).data.code).toBe('file_limit');
    expect((await client.call('read_file',{path:'src/schemas.ts',start_line:9000})).data.code).toBe('invalid_range');
    expect((await client.call('read_file',{path:'src/schemas.ts',start_line:0})).isError).toBe(true);
  });
  it('denies traversal, secrets, binaries and ignores including nested rules',async()=>{
    const {client}=await setup(async r=>{
      await fs.writeFile(path.join(r,'.env'),'DEEPSEEK_API_KEY=secret');await fs.writeFile(path.join(r,'credentials.json'),'{}');
      await fs.writeFile(path.join(r,'.gitignore'),'docs/ignored.md\n');await fs.writeFile(path.join(r,'.assistantignore'),'docs/private.md\n');
      await fs.writeFile(path.join(r,'docs/.gitignore'),'nested.md\n');
      for(const n of ['ignored.md','private.md','nested.md'])await fs.writeFile(path.join(r,'docs',n),'hidden');
      await fs.writeFile(path.join(r,'docs/binary.md'),Buffer.from([0,1,2]));
      await fs.writeFile(path.join(r,'docs/credential-in-text.md'),'-----BEGIN PRIVATE KEY-----');
    });
    for(const p of ['../outside.md','/etc/passwd','C:/outside.md','a/../../outside.md','a\\b','docs/x:stream','docs/x.','.env','credentials.json','docs/ignored.md','docs/private.md','docs/nested.md','docs/binary.md','docs/credential-in-text.md'])expect((await client.call('read_file',{path:p})).isError,p).toBe(true);
    const list=await client.call('list_files',{});expect(JSON.stringify(list.data)).not.toContain('ignored.md');expect(JSON.stringify(list.data)).not.toContain('.env');
    expect((await stage(client,'src/new.ts','source')).data.code).toBe('write_denied');
  });
  it('rejects directory symlinks/junctions outside and inside root',async()=>{
    const outside=await fixture();repos.push(outside);
    const {client}=await setup(async r=>{await fs.symlink(outside,path.join(r,'external'),'junction');await fs.symlink(path.join(r,'docs'),path.join(r,'internal'),'junction');});
    for(const p of ['external/docs/chat-api.md','internal/chat-api.md'])expect((await client.call('read_file',{path:p})).data.code).toBe('symlink_denied');
    expect((await stage(client,'external/docs/new.md','x')).isError).toBe(true);
  });
  it('stages create and modify without changing working copy; rejects conflicts and applies idempotently',async()=>{
    const {repo,client}=await setup();const before=await fs.readFile(path.join(repo,'docs/chat-api.md'),'utf8');
    expect((await stage(client,'docs/new.md','# New report\n')).isError).toBe(false);
    expect((await stage(client,'docs/chat-api.md',before+'\nUpdated.\n')).isError).toBe(false);
    expect(await fs.readFile(path.join(repo,'docs/chat-api.md'),'utf8')).toBe(before);
    await expect(fs.stat(path.join(repo,'docs/new.md'))).rejects.toMatchObject({code:'ENOENT'});
    const preview=await client.call('preview_changes',{});expect(preview.data.files).toHaveLength(2);expect(preview.data.patch).toContain('--- /dev/null');expect(preview.data.patch).toContain('+Updated.');
    const apply=await applyRun(repo,'test-run');expect(apply.status).toBe('applied');expect(apply.written).toHaveLength(2);
    expect((await applyRun(repo,'test-run')).status).toBe('already_applied');
    expect(await fs.readFile(path.join(repo,'docs/new.md'),'utf8')).toBe('# New report\n');
  });
  it('preflights every original before writing and refuses newly occupied paths',async()=>{
    const {repo,client}=await setup();await stage(client,'docs/a-new.md','new');await stage(client,'docs/chat-api.md','updated');
    await fs.appendFile(path.join(repo,'docs/chat-api.md'),'external edit');
    const result=await applyRun(repo,'test-run');expect(result.status).toBe('conflict');expect(result.written).toEqual([]);
    await expect(fs.stat(path.join(repo,'docs/a-new.md'))).rejects.toMatchObject({code:'ENOENT'});
    expect((await stage(client,'docs/chat-api.md','second')).isError).toBe(false);
    await fs.writeFile(path.join(repo,'docs/a-new.md'),'appeared');expect((await applyRun(repo,'test-run')).status).toBe('conflict');
  });
  it('reports partial writes and resumes without duplicating them',async()=>{
    const {repo,client}=await setup();await stage(client,'docs/a.md','A');await stage(client,'docs/b.md','B');
    const failed=await applyRun(repo,'test-run',{beforeWrite:async n=>{if(n===1)throw new Error('disk failure');}});
    expect(failed.status).toBe('partial');expect(failed.written).toEqual(['docs/a.md']);
    const result=await applyRun(repo,'test-run');expect(result.written).toEqual(['docs/b.md']);expect(result.already_applied).toEqual(['docs/a.md']);
  });
  it('checks hash, evidence, full-document reads and hardlinks',async()=>{
    const {repo,client}=await setup();
    const ref={path:'src/routes.ts',start_line:1,end_line:2,sha256:hash('fake')};
    expect((await client.call('stage_file_change',{path:'docs/new.md',expected_hash:null,content:'x',explanation:'x',sources:[ref]})).data.code).toBe('unread_source');
    await fs.link(path.join(repo,'docs/chat-api.md'),path.join(repo,'docs/hard.md'));
    expect((await stage(client,'docs/hard.md','x')).data.code).toBe('hardlink_denied');
    const store=await new Store(await new Policy(repo).init(),'test-run').init(false);expect(store.manifest.changes).toEqual([]);
  });
  it('loads scoped AGENTS as application rules and prevents writing them',async()=>{
    const {client}=await setup(async r=>{await fs.writeFile(path.join(r,'AGENTS.md'),'Use clear language.');await fs.writeFile(path.join(r,'docs/AGENTS.md'),'Preserve headings.');});
    const read=await client.call('read_file',{path:'docs/chat-api.md'});expect((read.data.project_rules as any[]).map(r=>r.scope)).toEqual(['','docs']);
    expect((await stage(client,'docs/AGENTS.md','override')).data.code).toBe('write_denied');
  });
  it('refuses stale hashes and incomplete original reads',async()=>{
    const {client}=await setup();
    const source=(await client.call('read_file',{path:'src/schemas.ts'})).data as any;
    const old=(await client.call('read_file',{path:'docs/chat-api.md',start_line:1,end_line:1})).data as any;
    const proposal={path:'docs/chat-api.md',expected_hash:'0'.repeat(64),content:'replacement',explanation:'test',sources:[{path:source.path,start_line:1,end_line:2,sha256:source.sha256}]};
    expect((await client.call('stage_file_change',proposal)).data.code).toBe('hash_conflict');
    expect((await client.call('stage_file_change',{...proposal,expected_hash:old.sha256})).data.code).toBe('incomplete_read');
  });
  it('preserves UTF-8 and CRLF bytes and detects changed evidence',async()=>{
    const {repo,client}=await setup(async r=>{await fs.writeFile(path.join(r,'docs/unicode.md'),'# Отчёт\r\nСтрока ☀\r\n');});
    const read=await client.call('read_file',{path:'docs/unicode.md'});expect(read.data.sha256).toBe(hash('# Отчёт\r\nСтрока ☀\r\n'));
    expect((await stage(client,'docs/unicode.md','# Отчёт\r\nНовая строка ☀\r\n')).isError).toBe(false);
    expect((await applyRun(repo,'test-run')).status).toBe('applied');expect(await fs.readFile(path.join(repo,'docs/unicode.md'),'utf8')).toBe('# Отчёт\r\nНовая строка ☀\r\n');
  });
  it('revalidates exclusions, manifests and links when applying',async()=>{
    const {repo,client}=await setup();await stage(client,'docs/new.md','new');
    await fs.writeFile(path.join(repo,'.assistantignore'),'docs/new.md\n');
    expect((await applyRun(repo,'test-run')).error?.code).toBe('forbidden_file');
    await fs.writeFile(path.join(repo,'.assistantignore'),'');
    const file=path.join(repo,'.assistant/runs/test-run/manifest.json');const manifest=JSON.parse(await fs.readFile(file,'utf8'));manifest.changes[0].path='../outside.md';await fs.writeFile(file,JSON.stringify(manifest));
    expect((await applyRun(repo,'test-run')).error?.code).toBe('invalid_path');
  });
  it('will not overwrite a file appearing after preflight',async()=>{
    const {repo,client}=await setup();await stage(client,'docs/new.md','ours');
    const result=await applyRun(repo,'test-run',{beforeWrite:async()=>{await fs.writeFile(path.join(repo,'docs/new.md'),'external');}});
    expect(result.status).toBe('conflict');expect(await fs.readFile(path.join(repo,'docs/new.md'),'utf8')).toBe('external');
  });
});
