#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const reportPath = process.argv[2] || path.resolve(process.cwd(), 'eslint-report.json');
const outMd = path.resolve(process.cwd(), 'cleanup/ESLINT_WARNINGS_SUMMARY.md');

let raw;
try {
  raw = fs.readFileSync(reportPath, 'utf8');
} catch (err) {
  console.error(`Failed to read ${reportPath}: ${err.message}`);
  process.exit(2);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error(`Failed to parse JSON from ${reportPath}: ${err.message}`);
  process.exit(2);
}

// Aggregate warnings (severity === 1)
const agg = new Map();

for (const file of data) {
  const filePath = path.relative(process.cwd(), file.filePath || file.path || '') || file.filePath;
  for (const msg of file.messages || []) {
    if (msg.severity !== 1) continue; // only warnings
    const rule = msg.ruleId || '(no-rule)';
    const existing = agg.get(rule) || { count: 0, samples: [] };
    existing.count += 1;
    if (existing.samples.length < 3) {
      existing.samples.push({ file: filePath, line: msg.line || 0, message: msg.message });
    }
    agg.set(rule, existing);
  }
}

const sorted = Array.from(agg.entries()).sort((a, b) => b[1].count - a[1].count);

// Build markdown
let md = '# ESLint Warnings Summary\n\n';
md += `Generated: ${new Date().toISOString()}\n\n`;
md += '| Rule | Count | Examples (file:line — message) |\n';
md += '| --- | ---: | --- |\n';

for (const [rule, info] of sorted) {
  const examples = info.samples.map(s => `\`${s.file}\`:${s.line} — ${s.message.replace(/\|/g, '\\|')}`).join('<br>');
  md += `| ${rule} | ${info.count} | ${examples} |\n`;
}

try {
  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, md, 'utf8');
  console.log(`Wrote summary to ${outMd}`);
  console.log('\n---\n');
  console.log(md);
} catch (err) {
  console.error(`Failed to write summary: ${err.message}`);
  process.exit(3);
}
