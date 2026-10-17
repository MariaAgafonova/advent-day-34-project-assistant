import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { Fault, LIMITS, hash, relative, safeText, type Rule } from './common.js';

const directories = new Set(['.git','.assistant','.ssh','.aws','.azure','.codex','.agents','node_modules','vendor','.venv','venv','env','virtualenv','build','dist','target','coverage','artifacts','test-results','playwright-report','__pycache__','.pytest_cache','.cache','.data','.gradle','.kotlin','.idea','.wrangler']);
const textExtensions = new Set(['.md','.markdown','.txt','.rst','.adoc','.ts','.tsx','.js','.jsx','.mjs','.cjs','.py','.kt','.kts','.java','.json','.jsonc','.yaml','.yml','.toml','.xml','.sql','.css','.html','.sh','.ps1','.gradle','.properties','.ini','.cfg','.go','.rs','.c','.h','.cpp','.cs','.rb','.php','.swift','.proto','.graphql','.csv','.gitignore']);
const docExtensions = new Set(['.md','.markdown','.txt','.rst','.adoc']);
export function forbidden(p: string): boolean {
  const parts=p.toLowerCase().split('/'), name=parts.at(-1)!;
  return parts.some(x=>directories.has(x)) || /^(\.env|\.dev\.vars)/.test(name) ||
    /^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials?|secrets?)(?:\.|$)/.test(name) ||
    /(?:credential|service[-_]?account)/.test(name) || /(?:^|[._-])(?:secrets?|tokens?|passwords?)(?:[._-]|$)/.test(name) || ['.npmrc','.netrc','.pypirc','local.properties'].includes(name) ||
    /\.(pem|key|p12|pfx|jks|keystore|lock|map)$/.test(name) || /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(name);
}
export class Policy {
  root=''; files: string[]=[]; truncated=false; rules: Rule[]=[];
  private ignores: {scope:string; matcher:Ignore}[]=[];
  private docDirs=['docs','knowledge'];
  private entries=0;
  constructor(private input: string) {}
  async init() {
    this.root=await fs.realpath(this.input);
    if(!(await fs.stat(this.root)).isDirectory()) throw new Fault('invalid_repo','Корень должен быть каталогом.');
    const config=path.join(this.root,'.assistant-config.json');
    try {
      await this.checked('.assistant-config.json');
      const raw=await this.small(config);
      const value=JSON.parse(raw) as {documentationDirectories?:unknown};
      if(value.documentationDirectories!==undefined) {
        if(!Array.isArray(value.documentationDirectories)||value.documentationDirectories.length>20||value.documentationDirectories.some(x=>typeof x!=='string')) throw new Error();
        this.docDirs.push(...value.documentationDirectories.map(x=>relative(x as string)));
      }
    } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw new Fault('invalid_config','Проверьте .assistant-config.json и ссылки в его пути.'); }
    await this.walk('');
    this.files.sort();
    return this;
  }
  private async small(file: string) {
    if((await fs.stat(file)).size>32_768) throw new Fault('rules_limit','Файл правил превышает 32 KiB.');
    return safeText(await fs.readFile(file,'utf8'));
  }
  private ignored(p:string) {
    return this.ignores.some(({scope,matcher})=> (!scope||p.startsWith(scope+'/')) && matcher.ignores(scope?p.slice(scope.length+1):p));
  }
  private async walk(dir:string):Promise<void> {
    if(this.files.length>=LIMITS.files){this.truncated=true;return;}
    const abs=path.join(this.root,dir);
    for(const name of ['.gitignore',...(dir?[]:['.assistantignore'])]) {
      const p=dir?dir+'/'+name:name;
      try { await this.checked(p); this.ignores.push({scope:dir,matcher:ignore().add(await this.small(path.join(this.root,p)))}); }
      catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw new Fault('invalid_ignore','Не удалось безопасно загрузить правила исключения.'); }
    }
    const entries=await fs.readdir(abs,{withFileTypes:true}); entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
    for(const entry of entries) {
      if(++this.entries>LIMITS.files){this.truncated=true;return;}
      const p=dir?dir+'/'+entry.name:entry.name;
      if(forbidden(p)||entry.isSymbolicLink()||this.ignored(p+(entry.isDirectory()?'/':'')))continue;
      try { relative(p); } catch {continue;}
      if(entry.isDirectory()){await this.walk(p);continue;}
      if(!entry.isFile()||!this.text(p))continue;
      this.files.push(p);
      if(entry.name==='AGENTS.md'){
        await this.checked(p);const text=await this.small(path.join(this.root,p));
        if(this.rules.reduce((n,r)=>n+Buffer.byteLength(r.text),0)+Buffer.byteLength(text)>6_000) throw new Fault('rules_limit','Суммарный размер AGENTS.md превышает 6000 байт.');
        this.rules.push({path:p,scope:dir,sha256:hash(text),text});
      }
    }
  }
  text(p:string) { return textExtensions.has(path.posix.extname(p).toLowerCase()) || /^(readme|dockerfile|makefile|\.gitignore|\.assistantignore)$/i.test(path.posix.basename(p)); }
  async checked(p:string, allowMissing=false):Promise<string> {
    relative(p);
    let current=this.root;
    for(const part of p.split('/')) {
      current=path.join(current,part);
      try {
        const info=await fs.lstat(current);
        if(info.isSymbolicLink())throw new Fault('symlink_denied','Символьные ссылки и junction не разрешены.');
        const resolved=await fs.realpath(current), rel=path.relative(this.root,resolved);
        if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Fault('outside_root','Путь выходит за корень.');
      }catch(e){if(allowMissing&&(e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
    }
    return current;
  }
  async access(p:string, write=false, missing=false) {
    relative(p);
    if(forbidden(p)||this.ignored(p))throw new Fault('forbidden_file','Файл запрещён политикой доступа или правилами исключения.');
    if(!this.text(p))throw new Fault('binary_file','Поддерживаются только разрешённые текстовые форматы.');
    if(write) {
      const name=path.posix.basename(p), suffix=path.posix.extname(p).toLowerCase();
      if(name==='AGENTS.md'||!(/^(README)(?:\.(md|markdown|txt|rst|adoc))?$/i.test(name) || (docExtensions.has(suffix)&&this.docDirs.some(dir=>p.startsWith(dir+'/'))))) throw new Fault('write_denied','Изменять можно только README и разрешённую документацию.');
    }
    const abs=await this.checked(p,missing);
    try {const st=await fs.lstat(abs);if(!st.isFile())throw new Fault('not_file','Путь не является обычным файлом.');if(write&&st.nlink>1)throw new Fault('hardlink_denied','Изменение hardlink запрещено.');}
    catch(e){if(!(missing&&(e as NodeJS.ErrnoException).code==='ENOENT'))throw e;}
    return abs;
  }
  async read(p:string) {
    const abs=await this.access(p), handle=await fs.open(abs,'r');
    try {
      const before=await handle.stat();
      if(before.size>LIMITS.fileBytes)throw new Fault('file_limit','Файл превышает 256 KiB.');
      const buffer=Buffer.alloc(LIMITS.fileBytes+1);let size=0;
      while(size<buffer.length){const r=await handle.read(buffer,size,buffer.length-size,null);if(!r.bytesRead)break;size+=r.bytesRead;}
      if(size>LIMITS.fileBytes)throw new Fault('file_limit','Файл превышает 256 KiB.');
      const data=buffer.subarray(0,size);
      if(data.includes(0))throw new Fault('binary_file','Двоичное содержимое запрещено.');
      let text:string;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);}catch{throw new Fault('binary_file','Требуется UTF-8 текст.');}
      safeText(text);await this.checked(p);
      const after=await handle.stat();if(before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw new Fault('file_changed','Файл изменился во время чтения.');
      return {text,sha256:hash(data),size};
    }finally{await handle.close();}
  }
  rulesFor(p:string) {return this.rules.filter(r=>!r.scope||p===r.scope||p.startsWith(r.scope+'/'));}
}
