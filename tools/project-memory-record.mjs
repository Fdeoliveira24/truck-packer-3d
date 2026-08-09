#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const die = m => {
  process.stderr.write(`project-memory-record: ${m}\n`);
  process.exit(1);
};
const san = s => String(s || '').replace(/\r\n/g, '\n').trim();
const hasSecret = s => [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/,
  /\b(xox[baprs]-|ghp_|github_pat_|sk-[A-Za-z0-9]{20,})\b/,
  /\b(password|secret|token|api[_-]?key)\b\s*[:=]\s*\S+/i,
].some(rx => rx.test(s));
const git = (repo, args) => {
  const x = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return x.status === 0 ? String(x.stdout || '').trim() : '';
};
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'session';
const uniq = (dir, base) => {
  let p = path.join(dir, `${base}.md`);
  let n = 1;
  while (fs.existsSync(p)) {
    p = path.join(dir, `${base}-${n}.md`);
    n += 1;
  }
  return p;
};

const args = {
  project: '', vaultRoot: '', repo: '', assistant: '', objective: '', workCompleted: '', filesInvolved: '', tests: '', result: '',
  problems: '', fixes: '', decisions: '', lessons: '', remainingWork: '', nextAction: '', references: '',
};
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i += 1) {
  const a = av[i];
  if (a === '--help' || a === '-h') {
    console.log('Usage: tools/project-memory record --assistant <name> --objective <text> --work-completed <text> [fields]');
    process.exit(0);
  }
  if (!a.startsWith('--')) die(`unknown argument: ${a}`);
  const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!(k in args)) die(`unknown option: ${a}`);
  args[k] = String(av[++i] || '').trim();
}

if (!args.project || !/^[A-Za-z0-9._-]+$/.test(args.project)) die('invalid or missing --project');
if (!args.vaultRoot) die('missing --vault-root');
if (!args.repo) die('missing --repo');
if (!args.assistant) die('missing --assistant');
const objective = san(args.objective);
const work = san(args.workCompleted);
if (objective.length < 12 || work.length < 20) die('session content is too trivial');

const vault = path.resolve(args.vaultRoot);
const sessions = path.join(vault, 'Sessions');
if (!fs.existsSync(sessions)) die(`sessions dir not found: ${sessions}`);
const repo = path.resolve(args.repo);
if (!fs.existsSync(path.join(repo, '.git'))) die(`repo path is not a git repository: ${repo}`);

const fields = {
  objective,
  workCompleted: work,
  filesInvolved: san(args.filesInvolved),
  tests: san(args.tests),
  result: san(args.result),
  problems: san(args.problems),
  fixes: san(args.fixes),
  decisions: san(args.decisions),
  lessons: san(args.lessons),
  remainingWork: san(args.remainingWork),
  nextAction: san(args.nextAction),
  references: san(args.references),
};

const aggregate = Object.values(fields).join('\n');
if (aggregate.length > 16000) die('session payload too large');
if (hasSecret(aggregate)) die('secret-like material detected');

const branch = git(repo, ['branch', '--show-current']) || 'unknown';
const commit = git(repo, ['rev-parse', 'HEAD']) || 'unknown';
const shortCommit = commit === 'unknown' ? 'unknown' : commit.slice(0, 12);
const iso = new Date().toISOString();
const day = iso.slice(0, 10);
const stamp = iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const base = `${day.replace(/-/g, '')}-${stamp.slice(9, 15)}-${slug(objective)}`;
const target = uniq(sessions, base);

const content = [
  '---',
  `title: Session - ${objective.slice(0, 80)}`,
  `date: ${iso}`,
  `project: ${args.project}`,
  'type: Session',
  'status: recorded',
  `assistant: ${args.assistant}`,
  `source_commit: ${commit}`,
  '---',
  '',
  '## Context',
  `- Repo: ${repo}`,
  `- Branch: ${branch}`,
  `- Commit: ${shortCommit}`,
  '',
  '## Objective',
  objective,
  '',
  '## Work Completed',
  work,
  '',
  '## Files Involved',
  fields.filesInvolved || '- Not provided',
  '',
  '## Tests',
  fields.tests || '- Not provided',
  '',
  '## Result',
  fields.result || '- Not provided',
  '',
  '## Problems',
  fields.problems || '- None recorded',
  '',
  '## Fixes',
  fields.fixes || '- None recorded',
  '',
  '## Decisions',
  fields.decisions || '- None recorded',
  '',
  '## Lessons',
  fields.lessons || '- None recorded',
  '',
  '## Remaining Work',
  fields.remainingWork || '- None recorded',
  '',
  '## Next Action',
  fields.nextAction || '- None recorded',
  '',
  '## References',
  fields.references || '- None recorded',
  '',
].join('\n');

fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
console.log(target);
