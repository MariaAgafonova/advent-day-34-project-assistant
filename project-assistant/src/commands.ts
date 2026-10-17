import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { Fault, atomicJson, runId, safeError } from './common.js';
import { Policy } from './policy.js';
import { Store } from './store.js';

export const HELP = `Локальный ассистент проекта (PowerShell: .\\pa)

  .\\pa task "Цель задачи" [--run ID] [--env-file PATH]
  .\\pa runs                     Список запусков и статусов предложений
  .\\pa diff ID                  Посмотреть подготовленный diff
  .\\pa apply ID                 Применить проверенное предложение
  .\\pa config --env-file PATH   Сохранить путь к настройкам LLM
  .\\pa config                   Показать сохранённый путь
  .\\pa help

Корень проекта — текущая папка; --repo PATH выбирает другой корень.
Для команды без .\\: Set-Alias pa "$PWD\\pa.cmd" (на текущий сеанс).
Прежний формат --repo PATH --task GOAL и apply --run ID поддерживается.`;

export type Command = {
  name: 'help' | 'task' | 'apply' | 'diff' | 'runs' | 'config';
  repo: string; task?: string; run?: string; envFile?: string;
};
export function parseCommand(args: string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: {
      repo: {type:'string'}, task: {type:'string'}, run: {type:'string'},
      'env-file': {type:'string'}, help: {type:'boolean', short:'h'},
    }});
  } catch { throw new Fault('arguments', 'Проверьте аргументы: .\\pa help.'); }
  const {values, positionals} = parsed;
  const repo = values.repo ?? '.';
  if(values.help || (!args.length) || (positionals.length === 1 && positionals[0] === 'help')) return {name:'help', repo};
  const [name = values.task !== undefined ? 'task' : '', ...rest] = positionals;
  if(name === 'task') {
    if(rest.length > 1 || (rest.length && values.task !== undefined)) throw new Fault('arguments', 'Передайте одну задачу в кавычках: .\\pa task "Цель".');
    const task = rest[0] ?? values.task;
    if(!task?.trim()) throw new Fault('arguments', 'Укажите цель: .\\pa task "Цель".');
    return {name, repo, task, run: values.run === undefined ? undefined : runId(values.run), envFile:values['env-file']};
  }
  if(name === 'apply' || name === 'diff') {
    if(rest.length > 1 || (rest.length && values.run !== undefined) || values.task !== undefined || values['env-file'] !== undefined)
      throw new Fault('arguments', 'Используйте .\\pa '+name+' RUN_ID [--repo PATH].');
    const id = rest[0] ?? values.run;
    if(!id) throw new Fault('arguments', 'Укажите запуск: .\\pa '+name+' RUN_ID. Список: .\\pa runs.');
    return {name, repo, run:runId(id)};
  }
  if((name === 'runs' || name === 'config') && !rest.length && values.task === undefined && values.run === undefined &&
    (name === 'config' || values['env-file'] === undefined)) return {name, repo, envFile:values['env-file']};
  throw new Fault('arguments', 'Неизвестная команда или лишние аргументы. Справка: .\\pa help.');
}

const configPath = '.assistant/cli.json';
const configSchema = z.object({version:z.literal(1), env_file:z.string().min(1).max(4096).refine(path.isAbsolute)}).strict();

export async function savedEnvFile(repo: string): Promise<string | undefined> {
  const policy = await new Policy(repo).init();
  try {
    const file = await policy.checked(configPath);
    if((await fs.stat(file)).size > 8192) throw new Error();
    return configSchema.parse(JSON.parse(await fs.readFile(file,'utf8'))).env_file;
  } catch(e) {
    if((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Fault('invalid_cli_config', 'Проверьте .assistant/cli.json: нужен обычный файл с сохранённым абсолютным путём.');
  }
}
export async function saveEnvFile(repo: string, input: string): Promise<string> {
  const envFile = await fs.realpath(path.resolve(input));
  if(!(await fs.stat(envFile)).isFile()) throw new Fault('arguments', '--env-file должен указывать на файл.');
  const policy = await new Policy(repo).init();
  const file = await policy.checked(configPath, true);
  await fs.mkdir(path.dirname(file), {recursive:true});
  await policy.checked(configPath, true);
  await atomicJson(file, {version:1, env_file:envFile});
  return envFile;
}

export async function listRuns(repo: string): Promise<string> {
  const policy = await new Policy(repo).init();
  let directory: string;
  try { directory = await policy.checked('.assistant/runs'); }
  catch(e) { if((e as NodeJS.ErrnoException).code === 'ENOENT') return 'Запусков пока нет. Начните с .\\pa task "Цель".'; throw e; }
  const entries = (await fs.readdir(directory, {withFileTypes:true})).filter(e => e.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(e.name)).sort((a,b) => a.name.localeCompare(b.name));
  if(!entries.length) return 'Запусков пока нет. Начните с .\\pa task "Цель".';
  const rows = ['RUN_ID\tSTATUS\tFILES'];
  for(const entry of entries.slice(0,200)) {
    try {
      const {manifest} = await new Store(policy, entry.name).init(false);
      rows.push(`${entry.name}\t${manifest.status}\t${manifest.changes.length}`);
    } catch(e) { rows.push(`${entry.name}\t${safeError(e).code}\t-`); }
  }
  if(entries.length > 200) rows.push('Показаны первые 200 запусков по имени. Остальные: .assistant/runs/.');
  return rows.join('\n');
}
