// mend — the CLI SPEC.md specifies. Node 22, the standard library alone.
// Implements all of SPEC.md: the command line (section 1), output and exit
// codes (section 2), files/lines/paths (section 3), format detection
// (section 4), three-tier line matching (section 5), unified diffs
// (section 6), SEARCH/REPLACE blocks (section 7), V4A patches (section 8),
// JSON edits (section 9) and order/atomicity (section 10).
// Run as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and
// then this file hands over to runner.ts (the last lines below): keep that
// hand-over and runner.ts as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A file's text as lines, its line break and whether it ends with one (SPEC.md section 3). */
interface FileState {
  br: string;
  lines: string[];
  final: boolean;
}

function fileState(text: string): FileState {
  if (text === '') return { br: '\n', lines: [], final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { br, lines: parts, final };
}

function renderFile(f: FileState): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.final ? f.br : '');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  readonly moves: Array<{ from: string; to: string }> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** Section 5: matching lines. A tier key strips what that tier ignores. */
function tierKey(line: string, tier: number): string {
  if (tier === 0) return line;
  if (tier === 1) return line.replace(/[ \t]+$/, '');
  return line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** Every 0-based position where O occurs in lines at one tier (occurrences may overlap). */
function occurrences(lines: string[], o: string[], tier: number): number[] {
  const out: number[] = [];
  if (o.length === 0) return out;
  const want = o.map((l) => tierKey(l, tier));
  for (let i = 0; i + o.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < o.length; j++) {
      if (tierKey(lines[i + j]!, tier) !== want[j]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier at which O occurs at least once, with its positions; null when none. */
function findTier(lines: string[], o: string[], strict: boolean): { tier: number; occ: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const t of tiers) {
    const occ = occurrences(lines, o, t);
    if (occ.length > 0) return { tier: t, occ };
  }
  return null;
}

/** One line of N: a context line (written as the file's own matched line) or a new line. */
interface NLine {
  text: string;
  ctx: boolean;
  oIndex: number;
}

/** N as it is written at position `at`: context lines are the file's own lines; at tier 2 every other line is re-indented. */
function replacement(fileLines: string[], at: number, o: string[], n: NLine[], tier: number): string[] {
  const fLead = ((fileLines[at] ?? '').match(/^[ \t]*/) ?? [''])[0]!;
  const pLead = ((o[0] ?? '').match(/^[ \t]*/) ?? [''])[0]!;
  return n.map((nl) => {
    if (nl.ctx) return fileLines[at + nl.oIndex]!;
    if (tier !== 2) return nl.text;
    if (nl.text === '' || /^[ \t]+$/.test(nl.text)) return nl.text;
    if (nl.text.startsWith(pLead)) return fLead + nl.text.slice(pLead.length);
    return nl.text;
  });
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/** --- Unified diffs (SPEC.md section 6) --- */

interface Hunk {
  a: number;
  o: string[];
  n: NLine[];
  backslashAfterLast: boolean;
  backslashAfterLastPlus: boolean;
}

interface UniSection {
  oldPath: string | null;
  newPath: string | null;
  isCreate: boolean;
  isDelete: boolean;
  hunks: Hunk[];
}

function parseDiffGit(line: string): { x: string; y: string } | null {
  if (!line.startsWith('diff --git a/')) return null;
  const rest = line.slice('diff --git a/'.length);
  const idx = rest.lastIndexOf(' b/');
  if (idx < 0) return null;
  const x = rest.slice(0, idx);
  const y = rest.slice(idx + 3);
  if (x === '' || y === '') return null;
  return { x, y };
}

/** The path after `--- ` or `+++ `: text after the four characters, up to the first tab, surrounding spaces removed. */
function parsePathLine(line: string): string {
  let s = line.slice(4);
  const tab = s.indexOf('\t');
  if (tab >= 0) s = s.slice(0, tab);
  return s.trim();
}

/** `/dev/null` means no file; a leading `a/` or `b/` is removed from either. */
function normPath(p: string): string | null {
  if (p === '/dev/null') return null;
  if (p.startsWith('a/')) return p.slice(2);
  if (p.startsWith('b/')) return p.slice(2);
  return p;
}

/** A hunk header `@@ -A[,B] +C[,D] @@`, optionally followed by text: returns A, or null. */
function parseHunkHeader(line: string): number | null {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (m === null) return null;
  return Number(m[1]);
}

/** A hunk's body: lines starting with ` `, `-`, `+` or `\`, or empty; empty lines at its end are not part of it. */
function collectBody(lines: string[], start: number): { body: string[]; next: number } {
  const body: string[] = [];
  let j = start;
  while (j < lines.length) {
    const l = lines[j]!;
    // The body ends at a `--- ` line followed by a `+++ ` line: that pair starts the next section, it is not an old line.
    if (l.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
    if (l === '' || l.startsWith(' ') || l.startsWith('-') || l.startsWith('+') || l.startsWith('\\')) {
      body.push(l);
      j++;
    } else break;
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return { body, next: j };
}

function makeHunk(a: number, body: string[]): Hunk {
  const o: string[] = [];
  const n: NLine[] = [];
  let lastCtxOrPlus = -1;
  let lastPlus = -1;
  for (let k = 0; k < body.length; k++) {
    const l = body[k]!;
    if (l.startsWith(' ')) {
      const t = l.slice(1);
      o.push(t);
      n.push({ text: t, ctx: true, oIndex: o.length - 1 });
      lastCtxOrPlus = k;
    } else if (l.startsWith('-')) {
      o.push(l.slice(1));
    } else if (l.startsWith('+')) {
      n.push({ text: l.slice(1), ctx: false, oIndex: -1 });
      lastCtxOrPlus = k;
      lastPlus = k;
    } else if (l.startsWith('\\')) {
      // A `\` line refers to the body line before it; it carries no content.
    } else if (l === '') {
      o.push('');
      n.push({ text: '', ctx: true, oIndex: o.length - 1 });
      lastCtxOrPlus = k;
    }
  }
  const backslashAfterLast = lastCtxOrPlus >= 0 && body[lastCtxOrPlus + 1] !== undefined && body[lastCtxOrPlus + 1]!.startsWith('\\');
  const backslashAfterLastPlus = lastPlus >= 0 && body[lastPlus + 1] !== undefined && body[lastPlus + 1]!.startsWith('\\');
  return { a, o, n, backslashAfterLast, backslashAfterLastPlus };
}

/** Apply a section's hunks in order, each to the result of the ones before it. */
function applyHunks(text: string, hunks: Hunk[], strict: boolean, path: string): string {
  const f = fileState(text);
  let d = 0;
  for (const h of hunks) {
    if (h.o.length === 0) {
      const at = Math.min(h.a + d, f.lines.length);
      const atEnd = at === f.lines.length;
      const ins = h.n.map((nl) => nl.text);
      f.lines.splice(at, 0, ...ins);
      if (atEnd) f.final = !h.backslashAfterLast;
      d += h.n.length;
      continue;
    }
    const found = findTier(f.lines, h.o, strict);
    if (found === null) throw new Fail('no-match', path);
    const target = h.a - 1 + d;
    let best = found.occ[0]!;
    let bestDist = Math.abs(best - target);
    for (const pos of found.occ) {
      const dist = Math.abs(pos - target);
      if (dist < bestDist) {
        best = pos;
        bestDist = dist;
      }
    }
    const endsAtEnd = best + h.o.length === f.lines.length;
    const repl = replacement(f.lines, best, h.o, h.n, found.tier);
    f.lines.splice(best, h.o.length, ...repl);
    if (endsAtEnd) f.final = !h.backslashAfterLast;
    d += h.n.length - h.o.length;
  }
  return renderFile(f);
}

function unifiedSectionEdit(s: UniSection, strict: boolean): Edit {
  return (tree) => {
    const oldP = s.oldPath;
    const newP = s.newPath;
    if (oldP !== null && !safe(oldP)) throw new Fail('unsafe', oldP);
    if (newP !== null && !safe(newP)) throw new Fail('unsafe', newP);
    if (s.isCreate || oldP === null) {
      const target = newP!;
      if (tree.get(target) !== null) throw new Fail('exists', target);
      const plus: string[] = [];
      let lastPlusHunk: Hunk | null = null;
      for (const h of s.hunks) {
        let hasPlus = false;
        for (const nl of h.n) {
          if (!nl.ctx) {
            plus.push(nl.text);
            hasPlus = true;
          }
        }
        if (hasPlus) lastPlusHunk = h;
      }
      const finalBreak = lastPlusHunk === null ? true : !lastPlusHunk.backslashAfterLastPlus;
      tree.now.set(target, plus.length === 0 ? '' : plus.join('\n') + (finalBreak ? '\n' : ''));
      return;
    }
    if (s.isDelete || newP === null) {
      const target = oldP!;
      if (tree.get(target) === null) throw new Fail('missing', target);
      tree.now.set(target, null);
      return;
    }
    if (oldP !== newP) {
      if (tree.get(oldP) === null) throw new Fail('missing', oldP);
      if (tree.get(newP) !== null) throw new Fail('exists', newP);
      const text = applyHunks(tree.get(oldP)!, s.hunks, strict, oldP);
      tree.now.set(oldP, null);
      tree.now.set(newP, text);
      tree.moves.push({ from: oldP, to: newP });
      return;
    }
    const cur = tree.get(oldP);
    if (cur === null) throw new Fail('missing', oldP);
    tree.now.set(oldP, applyHunks(cur, s.hunks, strict, oldP));
  };
}

function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  interface Sec extends UniSection {
    hasDashPair: boolean;
    oldSetByDash: boolean;
    newSetByDash: boolean;
  }
  const sections: Sec[] = [];
  let cur: Sec | null = null;
  let inHeader = false;
  let i = 0;
  const newSection = (oldP: string | null, newP: string | null, dash: boolean): void => {
    cur = { oldPath: oldP, newPath: newP, isCreate: false, isDelete: false, hunks: [], hasDashPair: dash, oldSetByDash: dash, newSetByDash: dash };
    sections.push(cur);
    inHeader = true;
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const m = parseDiffGit(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      newSection(normPath(m.x), normPath(m.y), false);
      i++;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('@@')) {
        const a = parseHunkHeader(line);
        if (a === null) throw new Exit2(`error: parse ${i + 1}`);
        const { body, next } = collectBody(lines, i + 1);
        cur.hunks.push(makeHunk(a, body));
        inHeader = false;
        i = next;
        continue;
      }
      if (line.startsWith('--- ')) {
        if (!(lines[i + 1] ?? '').startsWith('+++ ')) throw new Exit2(`error: parse ${i + 2}`);
        cur.oldPath = normPath(parsePathLine(line));
        cur.newPath = normPath(parsePathLine(lines[i + 1]!));
        cur.hasDashPair = true;
        cur.oldSetByDash = true;
        cur.newSetByDash = true;
        i += 2;
        continue;
      }
      if (line.startsWith('+++ ')) {
        cur.newPath = normPath(parsePathLine(line));
        cur.newSetByDash = true;
        i++;
        continue;
      }
      if (line.startsWith('rename from ')) {
        if (!cur.oldSetByDash) cur.oldPath = line.slice(12).trim();
        i++;
        continue;
      }
      if (line.startsWith('rename to ')) {
        if (!cur.newSetByDash) cur.newPath = line.slice(10).trim();
        i++;
        continue;
      }
      if (line.startsWith('new file mode')) {
        cur.isCreate = true;
        i++;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        cur.isDelete = true;
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      newSection(normPath(parsePathLine(line)), normPath(parsePathLine(lines[i + 1]!)), true);
      i += 2;
      continue;
    }
    if (line.startsWith('@@')) {
      if (cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const a = parseHunkHeader(line);
      if (a === null) throw new Exit2(`error: parse ${i + 1}`);
      const { body, next } = collectBody(lines, i + 1);
      cur.hunks.push(makeHunk(a, body));
      i = next;
      continue;
    }
    i++;
  }
  return sections.map((s) => unifiedSectionEdit(s, strict));
}

/** --- SEARCH/REPLACE blocks (SPEC.md section 7) --- */

function srEdits(lines: string[], strict: boolean): Edit[] {
  const edits: Edit[] = [];
  let prevEnd = 0;
  let prevPath: string | null = null;
  let i = 0;
  const isSearch = (l: string): boolean => l.trimEnd() === '<<<<<<< SEARCH';
  const isEq = (l: string): boolean => l.trimEnd() === '=======';
  const isReplace = (l: string): boolean => l.trimEnd() === '>>>>>>> REPLACE';
  while (i < lines.length) {
    let s = -1;
    for (let j = i; j < lines.length; j++) {
      if (isSearch(lines[j]!)) {
        s = j;
        break;
      }
    }
    if (s < 0) break;
    let eq = -1;
    let rep = -1;
    for (let j = s + 1; j < lines.length; j++) {
      if (isEq(lines[j]!)) {
        eq = j;
        break;
      }
      if (isReplace(lines[j]!)) break;
    }
    if (eq >= 0) {
      for (let j = eq + 1; j < lines.length; j++) {
        if (isReplace(lines[j]!)) {
          rep = j;
          break;
        }
      }
    }
    if (eq < 0 || rep < 0) throw new Exit2(`error: parse ${s + 1}`);
    let path: string | null = null;
    for (let j = s - 1; j >= prevEnd; j--) {
      const t = lines[j]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw new Exit2(`error: parse ${s + 1}`);
    const oldLines = lines.slice(s + 1, eq);
    const newLines = lines.slice(eq + 1, rep);
    const p = path;
    edits.push((tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (oldLines.length === 0) {
        if (tree.get(p) !== null) throw new Fail('exists', p);
        tree.now.set(p, newLines.length === 0 ? '' : newLines.join('\n') + '\n');
        return;
      }
      const cur = tree.get(p);
      if (cur === null) throw new Fail('missing', p);
      const f = fileState(cur);
      const found = findTier(f.lines, oldLines, strict);
      if (found === null) throw new Fail('no-match', p);
      if (found.occ.length !== 1) throw new Fail('ambiguous', p);
      const at = found.occ[0]!;
      const repl = replacement(f.lines, at, oldLines, newLines.map((t) => ({ text: t, ctx: false, oIndex: -1 })), found.tier);
      f.lines.splice(at, oldLines.length, ...repl);
      tree.now.set(p, renderFile(f));
    });
    prevPath = path;
    prevEnd = rep + 1;
    i = rep + 1;
  }
  return edits;
}

/** --- V4A patches (SPEC.md section 8) --- */

interface VChunk {
  anchor: string | null;
  o: string[];
  n: NLine[];
  eof: boolean;
}

interface VSectionLine {
  line: string;
  no: number;
}

/** A section's lines until the next section or `*** End Patch`; blank lines at its end are not part of it. */
function collectV4ASection(lines: string[], start: number, end: number): { items: VSectionLine[]; next: number } {
  const items: VSectionLine[] = [];
  let j = start;
  while (j < end) {
    const l = lines[j]!;
    if (/^\*\*\* (Add|Delete|Update) File: /.test(l)) break;
    items.push({ line: l, no: j + 1 });
    j++;
  }
  while (items.length > 0 && blank(items[items.length - 1]!.line)) items.pop();
  return { items, next: j };
}

function v4aChunk(o: string[], n: NLine[], anchor: string | null, eof: boolean): VChunk {
  return { anchor, o, n, eof };
}

function v4aAddEdit(path: string, items: VSectionLine[]): Edit {
  const fileLines: string[] = [];
  for (const { line, no } of items) {
    if (line.startsWith('+')) fileLines.push(line.slice(1));
    else if (line === '') fileLines.push('');
    else throw new Exit2(`error: parse ${no}`);
  }
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (tree.get(path) !== null) throw new Fail('exists', path);
    tree.now.set(path, fileLines.length === 0 ? '' : fileLines.join('\n') + '\n');
  };
}

function v4aDeleteEdit(path: string, items: VSectionLine[]): Edit {
  if (items.length > 0) throw new Exit2(`error: parse ${items[0]!.no}`);
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (tree.get(path) === null) throw new Fail('missing', path);
    tree.now.set(path, null);
  };
}

function v4aUpdateEdit(path: string, items: VSectionLine[], headerNo: number, strict: boolean): Edit {
  let moveTo: string | null = null;
  let idx = 0;
  if (items.length > 0 && items[0]!.line.startsWith('*** Move to: ')) {
    moveTo = items[0]!.line.slice(13).trim();
    idx = 1;
  }
  interface RawChunk {
    anchor: string | null;
    body: string[];
    eof: boolean;
  }
  const raw: RawChunk[] = [];
  let cur: RawChunk | null = null;
  let started = false;
  for (; idx < items.length; idx++) {
    const { line, no } = items[idx]!;
    if (line.startsWith('@@')) {
      cur = { anchor: line.slice(2).trim(), body: [], eof: false };
      raw.push(cur);
      started = true;
      continue;
    }
    if (line.trimEnd() === '*** End of File') {
      if (cur === null) throw new Exit2(`error: parse ${no}`);
      cur.eof = true;
      cur = null;
      continue;
    }
    if (line.startsWith('*** Move to: ')) throw new Exit2(`error: parse ${no}`);
    if (line === '' || line.startsWith(' ') || line.startsWith('-') || line.startsWith('+')) {
      if (cur === null) {
        if (!started) {
          cur = { anchor: null, body: [], eof: false };
          raw.push(cur);
          started = true;
        } else throw new Exit2(`error: parse ${no}`);
      }
      cur.body.push(line);
      continue;
    }
    throw new Exit2(`error: parse ${no}`);
  }
  if (raw.length === 0 && moveTo === null) throw new Exit2(`error: parse ${headerNo}`);
  const chunks: VChunk[] = raw.map((r) => {
    const o: string[] = [];
    const n: NLine[] = [];
    for (const l of r.body) {
      if (l.startsWith(' ')) {
        const t = l.slice(1);
        o.push(t);
        n.push({ text: t, ctx: true, oIndex: o.length - 1 });
      } else if (l.startsWith('-')) o.push(l.slice(1));
      else if (l.startsWith('+')) n.push({ text: l.slice(1), ctx: false, oIndex: -1 });
      else if (l === '') {
        o.push('');
        n.push({ text: '', ctx: true, oIndex: o.length - 1 });
      }
    }
    return v4aChunk(o, n, r.anchor, r.eof);
  });
  return (tree) => {
    if (!safe(path)) throw new Fail('unsafe', path);
    if (moveTo !== null && !safe(moveTo)) throw new Fail('unsafe', moveTo);
    const curText = tree.get(path);
    if (curText === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    const f = fileState(curText);
    let cursor = 0;
    const tiers = strict ? [0] : [0, 1, 2];
    for (const ch of chunks) {
      if (ch.anchor !== null && ch.anchor !== '') {
        let foundAt = -1;
        for (const t of tiers) {
          for (let j = cursor; j < f.lines.length; j++) {
            if (tierKey(f.lines[j]!, t) === tierKey(ch.anchor, t)) {
              foundAt = j;
              break;
            }
          }
          if (foundAt >= 0) break;
        }
        if (foundAt < 0) throw new Fail('no-match', path);
        cursor = foundAt + 1;
      }
      if (ch.o.length === 0) {
        const at = ch.eof ? f.lines.length : cursor;
        const ins = ch.n.map((nl) => nl.text);
        f.lines.splice(at, 0, ...ins);
        cursor = at + ins.length;
        continue;
      }
      let found: { tier: number; pos: number } | null = null;
      for (const t of tiers) {
        const occ = occurrences(f.lines, ch.o, t).filter((p) => p >= cursor);
        if (ch.eof) {
          const endPos = f.lines.length - ch.o.length;
          if (occ.includes(endPos)) {
            found = { tier: t, pos: endPos };
            break;
          }
        } else if (occ.length > 0) {
          found = { tier: t, pos: occ[0]! };
          break;
        }
      }
      if (found === null) throw new Fail('no-match', path);
      const repl = replacement(f.lines, found.pos, ch.o, ch.n, found.tier);
      f.lines.splice(found.pos, ch.o.length, ...repl);
      cursor = found.pos + repl.length;
    }
    const text = renderFile(f);
    if (moveTo !== null) {
      tree.now.set(path, null);
      tree.now.set(moveTo, text);
      tree.moves.push({ from: path, to: moveTo });
    } else {
      tree.now.set(path, text);
    }
  };
}

function v4aEdits(lines: string[], strict: boolean): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let j = lines.length - 1; j >= 0; j--) {
    if (!blank(lines[j]!)) {
      last = j;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = /^\*\*\* Add File: (.*)$/.exec(line)) !== null) {
      const path = m[1]!.trim();
      const { items, next } = collectV4ASection(lines, i + 1, last);
      edits.push(v4aAddEdit(path, items));
      i = next;
      continue;
    }
    if ((m = /^\*\*\* Delete File: (.*)$/.exec(line)) !== null) {
      const path = m[1]!.trim();
      const { items, next } = collectV4ASection(lines, i + 1, last);
      edits.push(v4aDeleteEdit(path, items));
      i = next;
      continue;
    }
    if ((m = /^\*\*\* Update File: (.*)$/.exec(line)) !== null) {
      const path = m[1]!.trim();
      const { items, next } = collectV4ASection(lines, i + 1, last);
      edits.push(v4aUpdateEdit(path, items, i + 1, strict));
      i = next;
      continue;
    }
    throw new Exit2(`error: parse ${i + 1}`);
  }
  return edits;
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? srEdits(lines, strict) : v4aEdits(lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const movesLen = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = movesLen;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  interface Row {
    key: string;
    line: string;
  }
  let rows: Row[] = [];
  for (const p of [...tree.now.keys()]) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    rows.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  for (const mv of tree.moves) {
    const fromGone = tree.now.has(mv.from) && tree.now.get(mv.from) === null;
    const toHere = tree.now.has(mv.to) && tree.now.get(mv.to) !== null;
    if (tree.original(mv.from) !== null && fromGone && tree.original(mv.to) === null && toHere) {
      rows = rows.filter((r) => r.line !== `D ${mv.from}` && r.line !== `A ${mv.to}`);
      rows.push({ key: mv.to, line: `R ${mv.from} -> ${mv.to}` });
    }
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) {
    for (const p of [...tree.now.keys()]) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
