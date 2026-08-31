import fs from 'node:fs';
import path from 'node:path';

const [inputArg, outputArg = 'courses/mcgill-catalog.json'] = process.argv.slice(2);
if (!inputArg) {
  throw new Error('Usage: node scripts/build-mcgill-catalog.mjs <courses-YYYY-YYYY.json> [output.json]');
}

const input = JSON.parse(fs.readFileSync(path.resolve(inputArg), 'utf8'));
const authored = JSON.parse(fs.readFileSync(path.resolve('courses/courses.json'), 'utf8'));
const authoredCodes = new Set(authored.map((course) => course.code.replace(/\s+/g, '').toUpperCase()));

function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(value) {
  const compact = clean(value).replace(/^[,.:;\-–—]+|[,.:;\-–—]+$/g, '');
  if (!compact) return '';
  return compact[0].toUpperCase() + compact.slice(1);
}

function classifyKc(name) {
  if (/\b(apply|application|calculate|compute|design|develop|solve|technique|method|procedure|practice|analysis|modelling|modeling)\b/i.test(name)) return 'rule';
  if (/\b(principle|theory|mechanism|relationship|effect|interaction|process|dynamics|foundation)\b/i.test(name)) return 'principle';
  if (/\b(history|terminology|vocabulary|notation|definition)\b/i.test(name)) return 'fact';
  return 'concept';
}

function splitList(value) {
  const parts = [];
  let current = '';
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += character;
  }
  parts.push(current);
  return parts.flatMap((part) => part.split(/\s+and\s+|\s+including\s+|\s+with emphasis on\s+/i));
}

function kcNames(description, title) {
  const text = clean(description)
    .replace(/^[A-Za-z &()'\-/]+\s*:\s*/, '')
    .replace(/\b(selected|special) topics\b\.?/gi, '');
  const fragments = [];
  for (const sentence of text.split(/[.;]\s+/)) {
    const [lead, ...afterColon] = sentence.split(/:\s+/);
    if (afterColon.length && lead.length >= 8) fragments.push(lead);
    const detail = afterColon.length ? afterColon.join(': ') : sentence;
    const pieces = splitList(detail);
    fragments.push(...pieces);
  }

  const generic = /^(an?|the|this course|introduction to|advanced|fundamentals? of|overview of|study of|topics? include|selected topics? in)\s+/i;
  const seen = new Set();
  const result = [];
  for (const raw of fragments) {
    let name = titleCase(raw.replace(generic, '').replace(/\([^)]{80,}\)/g, ''));
    if (name.length > 120) name = `${name.slice(0, 117).replace(/\s+\S*$/, '')}…`;
    if (name.length < 3 || /^(and|or|etc|course|topics?)$/i.test(name)) continue;
    const key = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, type: classifyKc(name) });
    if (result.length === 8) break;
  }
  if (!result.length) result.push({ name: `Core work in ${clean(title)}`, type: 'concept' });
  return result;
}

function audience(number) {
  const level = Number.parseInt(String(number), 10);
  if (level >= 600) return ['graduate'];
  if (level >= 500) return ['undergraduate', 'graduate'];
  return ['undergraduate'];
}

const byCode = new Map();
for (const row of input) {
  const compactCode = clean(row._id || `${row.subject}${row.code}`).toUpperCase();
  // Includes standard, D1/D2/N1/N2, and approved lettered topic variants
  // such as HIST 409AA; excludes non-course administrative placeholders.
  if (!/^[A-Z]{2,6}\d{3,4}[A-Z0-9]{0,2}$/.test(compactCode) || authoredCodes.has(compactCode)) continue;
  const subject = clean(row.subject).toUpperCase();
  const number = clean(row.code).toUpperCase();
  const title = clean(row.title);
  if (!subject || !number || title.length < 2) continue;
  const numericCredits = Number.parseFloat(row.credits);
  const description = clean(row.description);
  const levels = audience(number);
  const audienceCode = levels.length === 2 ? 'b' : levels[0] === 'graduate' ? 'g' : 'u';
  const typeCode = { fact: 'f', association: 'a', concept: 'c', rule: 'r', principle: 'p' };
  byCode.set(compactCode, [
    `${subject} ${number}`,
    title,
    Number.isFinite(numericCredits) ? numericCredits : null,
    clean(row.department),
    clean(row.faculty),
    audienceCode,
    kcNames(description, title).map((kc) => [kc.name, typeCode[kc.type]]),
  ]);
}

const catalog = {
  schema_version: 1,
  institution: 'McGill University',
  catalog_year: '2026-2027',
  generated_from: 'mcgill-courses/mcgill.courses seed/courses-2026-2027.json (CC0); course facts sourced from McGill Course Catalogue',
  columns: ['code', 'title', 'credits', 'department', 'faculty', 'audience(u|b|g)', 'kcs[name,type(f|a|c|r|p)]'],
  courses: [...byCode.values()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })),
};

fs.writeFileSync(path.resolve(outputArg), `${JSON.stringify(catalog)}\n`);
console.log(`Wrote ${catalog.courses.length} courses to ${outputArg}`);
