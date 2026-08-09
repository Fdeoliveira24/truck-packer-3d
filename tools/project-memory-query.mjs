#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const die = (m, c = 1) => {
  process.stderr.write(`project-memory-query: ${m}\n`);
  process.exit(c);
};
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const words = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3);

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return { meta: {}, body: text };
  const raw = text.slice(4, end);
  const body = text.slice(end + 5);
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m && !meta[m[1]]) meta[m[1]] = m[2].trim();
  }
  return { meta, body };
}

function listMarkdownFiles(basePath) {
  if (!fs.existsSync(basePath)) return [];
  const st = fs.statSync(basePath);
  if (st.isFile()) return basePath.endsWith('.md') ? [path.resolve(basePath)] : [];
  const out = [];
  const stack = [basePath];
  while (stack.length) {
    const d = stack.pop();
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      const pst = fs.statSync(p);
      if (pst.isDirectory()) stack.push(p);
      else if (pst.isFile() && p.endsWith('.md')) out.push(path.resolve(p));
    }
  }
  return out;
}

function findPassage(body, query) {
  const lines = body.split(/\r?\n/);
  const qn = norm(query);
  const tk = words(query);
  let idx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const ln = norm(lines[i]);
    if (qn && ln.includes(qn)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const ln = norm(lines[i]);
      if (tk.some(t => ln.includes(t))) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return '';
  return lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 3)).join('\n').trim();
}

function scoreNote(note, query, queryTokens) {
  const qn = norm(query);
  const title = norm(note.title);
  const body = norm(note.body);
  const tags = norm(note.meta.tags || '');
  const type = norm(note.meta.type || '');
  const status = norm(note.meta.status || '');

  let score = 0;
  if (qn && title.includes(qn)) score += 80;
  if (qn && tags.includes(qn)) score += 40;
  if (qn && body.includes(qn)) score += 50;

  const uniqueBodyHits = new Set();
  for (const t of queryTokens) {
    if (title.includes(t)) score += 8;
    if (tags.includes(t)) score += 8;
    if (type.includes(t)) score += 6;
    if (status.includes(t)) score += 4;
    if (body.includes(t)) uniqueBodyHits.add(t);
  }
  score += Math.min(uniqueBodyHits.size * 3, 24);

  return score;
}

function jaccard(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let i = 0;
  for (const t of A) if (B.has(t)) i += 1;
  const u = A.size + B.size - i;
  return u ? i / u : 0;
}

let project = '';
let vaultRoot = '';
let query = '';
let max = 3;
let hardMax = 5;
let includeShared = false;
let asJson = false;
const pos = [];

const av = process.argv.slice(2);
for (let i = 0; i < av.length; i += 1) {
  const a = av[i];
  if (a === '--help' || a === '-h') {
    console.log('Usage: tools/project-memory query "<question>" [--max 3] [--json] [--include-shared]');
    process.exit(0);
  } else if (a === '--project') {
    project = String(av[++i] || '');
  } else if (a === '--vault-root') {
    vaultRoot = String(av[++i] || '');
  } else if (a === '--max') {
    max = Number(av[++i]);
  } else if (a === '--hard-max') {
    hardMax = Number(av[++i]);
  } else if (a === '--include-shared') {
    includeShared = true;
  } else if (a === '--json') {
    asJson = true;
  } else if (a.startsWith('-')) {
    die(`unknown option: ${a}`);
  } else {
    pos.push(a);
  }
}

query = pos.join(' ').trim();
if (!project || !/^[A-Za-z0-9._-]+$/.test(project) || project.includes('..')) die('invalid project id');
if (!query) die('missing query text');
max = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 3;
hardMax = Number.isFinite(hardMax) ? Math.max(1, Math.floor(hardMax)) : 5;
max = Math.min(max, hardMax, 5);

const vault = path.resolve(vaultRoot);
if (!fs.existsSync(vault)) {
  const payload = { project, query, results: [], message: 'vault not found' };
  console.log(asJson ? JSON.stringify(payload, null, 2) : `No meaningful result: vault not found at ${vault}`);
  process.exit(0);
}

const roots = [
  path.join(vault, 'Project.md'),
  path.join(vault, 'Decisions'),
  path.join(vault, 'Lessons'),
  path.join(vault, 'Problems'),
  path.join(vault, 'Sessions'),
];
if (includeShared) roots.push(path.join(path.dirname(path.dirname(vault)), 'Shared'));

const files = roots.flatMap(listMarkdownFiles).filter((v, i, a) => a.indexOf(v) === i);
const queryTokens = words(query);
const ranked = [];

for (const absPath of files) {
  let text = '';
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    continue;
  }
  const { meta, body } = parseFrontmatter(text);
  const title = (meta.title && String(meta.title).trim()) || path.basename(absPath, '.md');
  const note = { path: absPath, title, meta, body };
  const score = scoreNote(note, query, queryTokens);
  if (score < 12) continue;
  const passage = findPassage(body, query);
  if (!passage) continue;
  ranked.push({ score, passage, note });
}

ranked.sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path));
const deduped = [];
for (const candidate of ranked) {
  const isDup = deduped.some(existing => existing.note.path === candidate.note.path || jaccard(existing.passage, candidate.passage) >= 0.85);
  if (!isDup) deduped.push(candidate);
  if (deduped.length >= max) break;
}

if (!deduped.length) {
  const payload = { project, query, results: [], message: 'no meaningful result' };
  console.log(asJson ? JSON.stringify(payload, null, 2) : 'No meaningful result found in project-scoped memory.');
  process.exit(0);
}

const results = deduped.map(item => {
  const meta = item.note.meta || {};
  return {
    score: item.score,
    title: item.note.title,
    source: item.note.path,
    passage: item.passage,
    metadata: {
      date: meta.date || '',
      project: meta.project || '',
      type: meta.type || '',
      status: meta.status || '',
      tags: meta.tags || '',
      source_session: meta.source_session || '',
      source_commit: meta.source_commit || '',
      validated_at: meta.validated_at || '',
      supersedes: meta.supersedes || '',
    },
  };
});

if (asJson) {
  console.log(JSON.stringify({ project, query, maxResults: max, results }, null, 2));
  process.exit(0);
}

console.log(`Project: ${project}`);
console.log(`Query: ${query}`);
console.log(`Results: ${results.length}\n`);
for (let i = 0; i < results.length; i += 1) {
  const r = results[i];
  console.log(`${i + 1}. ${r.title}`);
  console.log(`   Source: ${r.source}`);
  console.log(`   Type: ${r.metadata.type || '-'} | Status: ${r.metadata.status || '-'} | Date: ${r.metadata.date || '-'}`);
  console.log(`   Passage:\n${r.passage.split('\n').map(line => `   ${line}`).join('\n')}\n`);
}
