#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const die = m => {
  process.stderr.write(`project-memory-promote: ${m}\n`);
  process.exit(1);
};
const hasSecret = s => [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/,
  /\b(xox[baprs]-|ghp_|github_pat_|sk-[A-Za-z0-9]{20,})\b/,
  /\b(password|secret|token|api[_-]?key)\b\s*[:=]\s*\S+/i,
].some(rx => rx.test(s));
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'note';
const uniq = (d, b) => {
  let p = path.join(d, `${b}.md`);
  let n = 1;
  while (fs.existsSync(p)) {
    p = path.join(d, `${b}-${n}.md`);
    n += 1;
  }
  return p;
};

const a = {
  project: '', vaultRoot: '', type: '', title: '', summary: '', status: 'accepted', tags: '', sourceSession: '', sourceCommit: '',
  validatedAt: '', supersedes: '', rationale: '', consequences: '', principle: '', rootCause: '', fix: '', verification: '', prevention: '',
};
const av = process.argv.slice(2);
for (let i = 0; i < av.length; i += 1) {
  const x = av[i];
  if (x === '--help' || x === '-h') {
    console.log('Usage: tools/project-memory promote --type <Decision|Lesson|Problem> --title <text> --summary <text> [metadata]');
    process.exit(0);
  }
  if (!x.startsWith('--')) die(`unknown argument: ${x}`);
  const k = x.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!(k in a)) die(`unknown option: ${x}`);
  a[k] = String(av[++i] || '').trim();
}

if (!a.project || !/^[A-Za-z0-9._-]+$/.test(a.project)) die('invalid or missing --project');
if (!a.vaultRoot) die('missing --vault-root');
if (!['Decision', 'Lesson', 'Problem'].includes(a.type)) die('type must be Decision, Lesson, or Problem');
if (a.title.trim().length < 8) die('title is too short');
if (a.summary.trim().length < 16) die('summary is too short');
if (hasSecret(Object.values(a).join('\n'))) die('secret-like material detected');

const vault = path.resolve(a.vaultRoot);
const dir = path.join(vault, `${a.type}s`);
if (!fs.existsSync(dir)) die(`target directory missing: ${dir}`);

const iso = new Date().toISOString();
const validated = a.validatedAt || iso.slice(0, 10);
const base = `${iso.slice(0, 10).replace(/-/g, '')}-${slug(a.title)}`;
const target = uniq(dir, base);

const fm = [
  '---',
  `title: ${a.title}`,
  `date: ${iso}`,
  `project: ${a.project}`,
  `type: ${a.type}`,
  `status: ${a.status || 'accepted'}`,
  `tags: ${a.tags || ''}`,
  `source_session: ${a.sourceSession || ''}`,
  `source_commit: ${a.sourceCommit || ''}`,
  `validated_at: ${validated}`,
  `supersedes: ${a.supersedes || ''}`,
  '---',
  '',
];

const body = ['## Summary', a.summary, ''];
if (a.type === 'Decision') {
  body.push('## Rationale', a.rationale || '- Not provided', '');
  body.push('## Consequences', a.consequences || '- Not provided', '');
} else if (a.type === 'Lesson') {
  body.push('## Reusable Principle', a.principle || '- Not provided', '');
  body.push('## Application Guidance', a.consequences || '- Not provided', '');
} else {
  body.push('## Root Cause', a.rootCause || '- Not provided', '');
  body.push('## Fix', a.fix || '- Not provided', '');
  body.push('## Verification', a.verification || '- Not provided', '');
  body.push('## Prevention', a.prevention || '- Not provided', '');
}

fs.writeFileSync(target, fm.concat(body).join('\n'), { encoding: 'utf8', flag: 'wx' });
console.log(target);
