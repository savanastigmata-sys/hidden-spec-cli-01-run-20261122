// Adversarial tests for mend, one per SPEC.md sentence the practice set does not show.
// Usage: node advtest.mjs
// Each case: {name, argv, stdin, files, exit, stdout, after} — `after` maps path -> text (null: deleted).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), 'main.ts');

const cases = [];
const C = (name, argv, stdin, files, exit, stdout, after) => cases.push({ name, argv, stdin, files, exit, stdout, after });

// --- 1. Invocation / usage ---
C('usage: --format without =', ['--format', 'p.diff'], null, { 'p.diff': 'x' }, 2, 'error: usage\n', { 'p.diff': 'x' });
C('usage: --check twice', ['--check', '--check', '-'], '', {}, 2, 'error: usage\n', {});
C('usage: --format twice', ['--format=json', '--format=v4a', '-'], '', {}, 2, 'error: usage\n', {});
C('usage: unknown option', ['--dry-run', 'p.diff'], null, { 'p.diff': 'x' }, 2, 'error: usage\n', { 'p.diff': 'x' });
C('usage: two positionals', ['a.patch', 'b.patch'], null, { 'a.patch': 'x', 'b.patch': 'y' }, 2, 'error: usage\n', { 'a.patch': 'x', 'b.patch': 'y' });
C('usage: -x short flag', ['-x'], null, {}, 2, 'error: usage\n', {});
C('usage: --format=bad value', ['--format=git', 'p.diff'], null, { 'p.diff': 'x' }, 2, 'error: usage\n', { 'p.diff': 'x' });
C('usage: -- after -- is positional', ['--', '--check'], null, { '--check': 'x' }, 2, 'error: format\n', { '--check': 'x' });
C('usage: -- then patch file', ['--', 'p.diff'], null, { 'p.diff': '{"command":"create","path":"n.txt","file_text":"hi\\n"}\n' }, 0, 'A n.txt\nok: 1 file\n', { 'p.diff': '{"command":"create","path":"n.txt","file_text":"hi\\n"}\n', 'n.txt': 'hi\n' });
C('no-patch: missing file', ['ghost.patch'], null, {}, 2, 'error: no-patch\n', {});
C('format: prose only', ['-'], 'just some words\nno format here\n', {}, 2, 'error: format\n', {});
C('format: empty stdin', ['-'], '', {}, 2, 'error: format\n', {});
C('parse 1: unified prose only, forced', ['--format=unified', '-'], 'hello world\n', {}, 2, 'error: parse 1\n', {});
C('parse 1: SR no blocks, forced', ['--format=search-replace', '-'], 'hello\n', {}, 2, 'error: parse 1\n', {});
C('parse 1: V4A begin/end only', ['-'], '*** Begin Patch\n*** End Patch\n', {}, 2, 'error: parse 1\n', {});
C('parse 1: JSON empty array', ['-'], '[]\n', {}, 2, 'error: parse 1\n', {});

// --- 6. Unified: no-newline handling ---
C('u-noeol: old last line has no newline, new adds one',
  ['-'],
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+three\n',
  { 'a.txt': 'one\ntwo' }, 0, 'M a.txt\nok: 1 file\n', { 'a.txt': 'one\nthree\n' });
C('u-noeol: new last line has no newline',
  ['-'],
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n\\ No newline at end of file\n',
  { 'a.txt': 'one\ntwo\n' }, 0, 'M a.txt\nok: 1 file\n', { 'a.txt': 'one\nthree' });
C('u-noeol: delete last line, file had no newline',
  ['-'],
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,1 @@\n one\n-two\n\\ No newline at end of file\n',
  { 'a.txt': 'one\ntwo' }, 0, 'M a.txt\nok: 1 file\n', { 'a.txt': 'one\n' });
C('u-noeol: context last line no newline, SPEC says break is added',
  ['-'],
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+two2\n three\n',
  { 'a.txt': 'one\ntwo\nthree' }, 0, 'M a.txt\nok: 1 file\n', { 'a.txt': 'one\ntwo2\nthree\n' });
C('u-noeol: create file without final break',
  ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'one\ntwo' });
C('u-noeol: create file with final break',
  ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'one\ntwo\n' });
C('u-noeol: insert at end, no newline after last +',
  ['-'],
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -2,0 +3,1 @@\n+three\n\\ No newline at end of file\n',
  { 'a.txt': 'one\ntwo\n' }, 0, 'M a.txt\nok: 1 file\n', { 'a.txt': 'one\ntwo\nthree' });
C('u-noeol: insert at end, newline kept',
  ['-'],
  'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -2,0 +3,1 @@\n+three\n',
  { 'a.txt': 'one\ntwo\n' }, 0, 'M a.txt\nok: 1 file\n', { 'a.txt': 'one\ntwo\nthree\n' });

// --- 6. Unified: structure / parse ---
C('u-parse: bad diff --git line',
  ['-'],
  'diff --git a/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 2, 'error: parse 1\n', { 'x': 'a\n' });
C('u-parse: bad hunk header',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -x +1 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 2, 'error: parse 4\n', { 'x': 'a\n' });
C('u-parse: hunk before any section',
  ['-'],
  '@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 2, 'error: format\n', { 'x': 'a\n' });
C('u-parse: --- not followed by +++ in header',
  ['-'],
  'diff --git a/x b/x\n--- a/x\nindex 123\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 2, 'error: parse 3\n', { 'x': 'a\n' });
C('u-parse: hunk header with trailing text',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@ func f\n a\n-b\n+c\n',
  { 'x': 'a\nb\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\nc\n' });
C('u-parse: --- path with tab timestamp',
  ['-'],
  'diff --git a/x b/x\n--- a/x\t2026-11-22 12:00:00\n+++ b/x\t2026-11-22 12:00:00\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'b\n' });
C('u-parse: old line starting with -- (not a section)',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- note\n-a\n+b\n',
  { 'x': '-- note\na\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'b\n' });

// --- 6. Unified: matching / drift ---
C('u-drift: two hunks, second A adjusted by d',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n a\n+ins\n@@ -3,1 +4,1 @@\n-c\n+d\n',
  { 'x': 'a\nb\nc\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\nins\nb\nd\n' });
C('u-drift: overlapping occurrences, nearest wins',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,2 +2,2 @@\n a\n a\n-b\n+c\n',
  { 'x': 'a\na\na\nb\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\na\na\nc\n' });
C('u-drift: tie goes to earlier occurrence',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -2,1 +2,1 @@\n-q\n+r\n',
  { 'x': 'q\ns\nq\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'r\ns\nq\n' });
C('u-drift: empty file, non-empty O',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'x': '' }, 1, 'error: no-match x\nfailed: 1 of 1 edits\n', { 'x': '' });
C('u-drift: empty-O insert into empty file',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1,1 @@\n+first\n',
  { 'x': '' }, 0, 'M x\nok: 1 file\n', { 'x': 'first\n' });
C('u-drift: strict blocks tier 1',
  ['--strict', '-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a \n+b\n',
  { 'x': 'a\n' }, 1, 'error: no-match x\nfailed: 1 of 1 edits\n', { 'x': 'a\n' });
C('u-drift: delete section ignores bad hunks',
  ['-'],
  'diff --git a/x b/x\ndeleted file mode 100644\n--- a/x\n+++ /dev/null\n@@ -1,1 +1,0 @@\n-gone\n',
  { 'x': 'gone\n' }, 0, 'D x\nok: 1 file\n', { 'x': null });
C('u-drift: create with no hunks makes empty file',
  ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': '' });
C('u-drift: rename only, no hunks',
  ['-'],
  'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n',
  { 'old.txt': 'same\n' }, 0, 'R old.txt -> new.txt\nok: 1 file\n', { 'old.txt': null, 'new.txt': 'same\n' });
C('u-drift: unsafe .. path',
  ['-'],
  'diff --git a/../evil b/../evil\n--- a/../evil\n+++ b/../evil\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'evil': 'a\n' }, 1, 'error: unsafe ../evil\nfailed: 1 of 1 edits\n', { 'evil': 'a\n' });
C('u-drift: unsafe backslash path',
  ['-'],
  'diff --git a/a\\b b/a\\b\n--- a/a\\b\n+++ b/a\\b\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  {}, 1, 'error: unsafe a\\b\nfailed: 1 of 1 edits\n', {});
C('u-drift: CRLF file, hunk at end keeps CRLF',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n',
  { 'x': 'a\r\nb\r\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\r\nc\r\n' });
C('u-drift: output sorted byte order',
  ['-'],
  'diff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-a\n+b\ndiff --git a/A.txt b/A.txt\n--- a/A.txt\n+++ b/A.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'b.txt': 'a\n', 'A.txt': 'a\n' }, 0, 'M A.txt\nM b.txt\nok: 2 files\n', { 'b.txt': 'b\n', 'A.txt': 'b\n' });

// --- 7. SEARCH/REPLACE ---
C('s-parse: first block no path line',
  ['-'],
  '<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 2, 'error: parse 1\n', { 'x': 'a\n' });
C('s-parse: second block inherits path',
  ['-'],
  'x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nb\n=======\nc\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'c\n' });
C('s-parse: path line with surrounding spaces',
  ['-'],
  '   x   \n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'b\n' });
C('s-create: empty old and empty new makes empty file',
  ['-'],
  'n.txt\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': '' });
C('s-tier2: re-indent new lines',
  ['-'],
  'x\n<<<<<<< SEARCH\n  foo\n=======\n  bar\n>>>>>>> REPLACE\n',
  { 'x': '    foo\n' }, 0, 'M x\nok: 1 file\n', { 'x': '    bar\n' });
C('s-tier2: new line without P prefix kept as-is',
  ['-'],
  'x\n<<<<<<< SEARCH\n  foo\n=======\nbar\n>>>>>>> REPLACE\n',
  { 'x': '    foo\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'bar\n' });
C('s-atomic: first block ok, second fails, nothing written',
  ['-'],
  'x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\ny\n<<<<<<< SEARCH\nq\n=======\nr\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 1, 'error: missing y\nfailed: 1 of 2 edits\n', { 'x': 'a\n' });
C('s-unsafe: ../ path',
  ['-'],
  '../x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 1, 'error: unsafe ../x\nfailed: 1 of 1 edits\n', { 'x': 'a\n' });

// --- 8. V4A ---
C('v-parse: first non-blank is not Begin Patch',
  ['--format=v4a', '-'],
  '\n\nhello\n*** Begin Patch\n*** End Patch\n',
  {}, 2, 'error: parse 3\n', {});
C('v-parse: no Begin Patch at all',
  ['--format=v4a', '-'],
  'hello\n',
  {}, 2, 'error: parse 1\n', {});
C('v-parse: End Patch missing',
  ['--format=v4a', '-'],
  '*** Begin Patch\n*** Add File: n.txt\n+x\n',
  {}, 2, 'error: parse 4\n', {});
C('v-parse: blank lines before Begin Patch ok',
  ['-'],
  '\n  \n*** Begin Patch\n*** Add File: n.txt\n+x\n*** End Patch\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'x\n' });
C('v-parse: Update with no chunk and no Move to',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n*** End Patch\n',
  { 'x': 'a\n' }, 2, 'error: parse 2\n', { 'x': 'a\n' });
C('v-parse: Delete File with lines',
  ['-'],
  '*** Begin Patch\n*** Delete File: x\n-foo\n*** End Patch\n',
  { 'x': 'a\n' }, 2, 'error: parse 3\n', { 'x': 'a\n' });
C('v-parse: End of File with no open chunk',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n*** End of File\n*** End Patch\n',
  { 'x': 'a\n' }, 2, 'error: parse 3\n', { 'x': 'a\n' });
C('v-parse: body line after EOF chunk without @@',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n a\n*** End of File\n b\n*** End Patch\n',
  { 'x': 'a\nb\n' }, 2, 'error: parse 5\n', { 'x': 'a\nb\n' });
C('v-parse: junk line between sections',
  ['-'],
  '*** Begin Patch\n*** Add File: n.txt\n+x\njunk\n*** End Patch\n',
  {}, 2, 'error: parse 4\n', {});
C('v-move: Move to only, no chunks',
  ['-'],
  '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** End Patch\n',
  { 'old.txt': 'same\n' }, 0, 'R old.txt -> new.txt\nok: 1 file\n', { 'old.txt': null, 'new.txt': 'same\n' });
C('v-anchor: anchor matches at tier 1',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n@@ anchor \n-  b\n+  c\n*** End Patch\n',
  { 'x': 'anchor\n  b\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'anchor\n  c\n' });
C('v-anchor: anchor not found',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n@@ nope\n-  b\n+  c\n*** End Patch\n',
  { 'x': 'a\n  b\n' }, 1, 'error: no-match x\nfailed: 1 of 1 edits\n', { 'x': 'a\n  b\n' });
C('v-insert: empty O inserts at cursor after anchor',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n@@ two\n+new\n*** End Patch\n',
  { 'x': 'one\ntwo\nthree\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'one\ntwo\nnew\nthree\n' });
C('v-insert: empty O EOF chunk inserts at end',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n+tail\n*** End of File\n*** End Patch\n',
  { 'x': 'one\ntwo\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'one\ntwo\ntail\n' });
C('v-add: trailing blank lines dropped',
  ['-'],
  '*** Begin Patch\n*** Add File: n.txt\n+a\n+b\n\n\n*** End Patch\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'a\nb\n' });
C('v-add: + empty lines kept',
  ['-'],
  '*** Begin Patch\n*** Add File: n.txt\n+a\n+\n+b\n*** End Patch\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'a\n\nb\n' });
C('v-crlf: update keeps CRLF and final break',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n a\n-b\n+c\n*** End Patch\n',
  { 'x': 'a\r\nb\r\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\r\nc\r\n' });
C('v-strict: tier 2 blocked by --strict',
  ['--strict', '-'],
  '*** Begin Patch\n*** Update File: x\n  b\n*** End Patch\n',
  { 'x': '    b\n' }, 1, 'error: no-match x\nfailed: 1 of 1 edits\n', { 'x': '    b\n' });

// --- 9. JSON ---
C('j-overlap: old_str occurs twice overlapping is ambiguous',
  ['-'],
  '{"command":"str_replace","path":"x","old_str":"aa","new_str":"b"}\n',
  { 'x': 'aaa\n' }, 1, 'error: ambiguous x\nfailed: 1 of 1 edits\n', { 'x': 'aaa\n' });
C('j-insert: at end of file',
  ['-'],
  '{"command":"insert","path":"x","insert_line":2,"new_str":"c"}\n',
  { 'x': 'a\nb\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\nb\nc\n' });
C('j-insert: past end is no-match',
  ['-'],
  '{"command":"insert","path":"x","insert_line":3,"new_str":"c"}\n',
  { 'x': 'a\nb\n' }, 1, 'error: no-match x\nfailed: 1 of 1 edits\n', { 'x': 'a\nb\n' });
C('j-array: array form with two edits',
  ['-'],
  '[{"command":"create","path":"n.txt","file_text":"hi"},{"command":"str_replace","path":"n.txt","old_str":"hi","new_str":"yo"}]\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'yo' });
C('j-create: file_text with CRLF kept byte for byte',
  ['-'],
  '{"command":"create","path":"n.txt","file_text":"a\\r\\nb"}\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'a\r\nb' });
C('j-fault: wrong command',
  ['-'],
  '{"command":"delete","path":"x"}\n',
  { 'x': 'a\n' }, 2, 'error: parse 1\n', { 'x': 'a\n' });
C('j-fault: missing file_text',
  ['-'],
  '{"command":"create","path":"x"}\n',
  {}, 2, 'error: parse 1\n', {});

// --- 2/10. Output, check, atomicity ---
C('check: --check writes nothing but same output',
  ['--check', '-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\n' });
C('atomic: two sections, second fails, disk unchanged',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\ndiff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -1,1 +1,1 @@\n-z\n+r\n',
  { 'x': 'a\n', 'y': 'q\n' }, 1, 'error: no-match y\nfailed: 1 of 2 edits\n', { 'x': 'a\n', 'y': 'q\n' });
C('noop: patch changes nothing prints ok 0',
  ['-'],
  'x\n<<<<<<< SEARCH\na\n=======\na\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 0, 'ok: 0 files\n', { 'x': 'a\n' });
C('r-sort: R line sorts by new path',
  ['-'],
  'diff --git a/zzz b/aaa\nrename from zzz\nrename to aaa\n--- a/zzz\n+++ b/aaa\n@@ -1,1 +1,1 @@\n-a\n+b\ndiff --git a/m.txt b/m.txt\n--- a/m.txt\n+++ b/m.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n',
  { 'zzz': 'a\n', 'm.txt': 'a\n' }, 0, 'R zzz -> aaa\nM m.txt\nok: 2 files\n', { 'zzz': null, 'aaa': 'b\n', 'm.txt': 'b\n' });
C('r-move: moved file then edited at new path still R',
  ['-'],
  'diff --git a/a.txt b/b.txt\nrename from a.txt\nrename to b.txt\n--- a/a.txt\n+++ b/b.txt\n@@ -1,1 +1,1 @@\n-a\n+c\n',
  { 'a.txt': 'a\n' }, 0, 'R a.txt -> b.txt\nok: 1 file\n', { 'a.txt': null, 'b.txt': 'c\n' });

// --- extra: counts, insertion bounds, fences, JSON delete ---
C('u-counts: header counts disagree with body are ignored',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n-a\n+b\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'b\n' });
C('u-insert: empty O with A past end inserts at end',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -10,0 +11,1 @@\n+tail\n',
  { 'x': 'one\ntwo\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'one\ntwo\ntail\n' });
C('u-forced: --format=unified on SR patch',
  ['--format=unified', '-'],
  'x\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 2, 'error: parse 1\n', { 'x': 'a\n' });
C('u-forced: --format=json on prose',
  ['--format=json', '-'],
  'hello\n',
  {}, 2, 'error: parse 1\n', {});
C('s-fence: fence line before SEARCH skipped for path',
  ['-'],
  'x\n```\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'b\n' });
C('s-tier1: old with trailing space matches',
  ['-'],
  'x\n<<<<<<< SEARCH\na \n=======\nb\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'b\n' });
C('j-delete: str_replace without new_str deletes',
  ['-'],
  '{"command":"str_replace","path":"x","old_str":"b"}\n',
  { 'x': 'ab\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\n' });
C('v-anchor-tier2: anchor found at tier 2',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n@@   b\n-  c\n+  d\n*** End Patch\n',
  { 'x': '  b\n    c\n' }, 0, 'M x\nok: 1 file\n', { 'x': '  b\n    d\n' });
C('v-chunk-noanchor: first chunk starts at body line',
  ['-'],
  '*** Begin Patch\n*** Update File: x\n a\n-b\n+c\n*** End Patch\n',
  { 'x': 'a\nb\n' }, 0, 'M x\nok: 1 file\n', { 'x': 'a\nc\n' });

// --- section 10: every failure is reported ---
C('fail2: two failing edits both reported',
  ['-'],
  'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-z\n+r\ndiff --git a/y b/y\n--- a/y\n+++ b/y\n@@ -1,1 +1,1 @@\n-z\n+r\n',
  { 'x': 'a\n', 'y': 'q\n' }, 1, 'error: no-match x\nerror: no-match y\nfailed: 2 of 2 edits\n', { 'x': 'a\n', 'y': 'q\n' });
C('s-parse: SEARCH with no =======',
  ['-'],
  'x\n<<<<<<< SEARCH\na\n>>>>>>> REPLACE\n',
  { 'x': 'a\n' }, 2, 'error: parse 2\n', { 'x': 'a\n' });
C('s-parse: SEARCH with no REPLACE',
  ['-'],
  'x\n<<<<<<< SEARCH\na\n=======\nb\n',
  { 'x': 'a\n' }, 2, 'error: parse 2\n', { 'x': 'a\n' });
C('s-missing: file does not exist',
  ['-'],
  'ghost\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n',
  {}, 1, 'error: missing ghost\nfailed: 1 of 1 edits\n', {});
C('v-exists: Add File that exists',
  ['-'],
  '*** Begin Patch\n*** Add File: n.txt\n+x\n*** End Patch\n',
  { 'n.txt': 'old\n' }, 1, 'error: exists n.txt\nfailed: 1 of 1 edits\n', { 'n.txt': 'old\n' });
C('v-missing: Delete File that is missing',
  ['-'],
  '*** Begin Patch\n*** Delete File: ghost\n*** End Patch\n',
  {}, 1, 'error: missing ghost\nfailed: 1 of 1 edits\n', {});
C('v-exists: Move to a path that exists',
  ['-'],
  '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** End Patch\n',
  { 'old.txt': 'a\n', 'new.txt': 'b\n' }, 1, 'error: exists new.txt\nfailed: 1 of 1 edits\n', { 'old.txt': 'a\n', 'new.txt': 'b\n' });
C('u-exists: create a file that exists',
  ['-'],
  'diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+x\n',
  { 'n.txt': 'old\n' }, 1, 'error: exists n.txt\nfailed: 1 of 1 edits\n', { 'n.txt': 'old\n' });
C('s-exists: create a file that exists',
  ['-'],
  'n.txt\n<<<<<<< SEARCH\n=======\nx\n>>>>>>> REPLACE\n',
  { 'n.txt': 'old\n' }, 1, 'error: exists n.txt\nfailed: 1 of 1 edits\n', { 'n.txt': 'old\n' });
C('j-create-empty: file_text empty makes empty file',
  ['-'],
  '{"command":"create","path":"n.txt","file_text":""}\n',
  {}, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': '' });

// --- run ---
let passed = 0;
const failed = [];
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), 'mend-adv-'));
  try {
    for (const [p, text] of Object.entries(c.files)) {
      const f = join(dir, ...p.split('/'));
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
    const r = spawnSync(process.execPath, [MAIN, ...c.argv], { cwd: dir, input: c.stdin ?? '', encoding: 'utf8', timeout: 10000 });
    const why = [];
    const exit = r.error !== undefined || r.status === null ? 124 : r.status;
    if (exit !== c.exit) why.push(`exit ${exit}, expected ${c.exit}`);
    if ((r.stdout ?? '') !== c.stdout) why.push(`stdout ${JSON.stringify(r.stdout)}, expected ${JSON.stringify(c.stdout)}`);
    const readTree = (d) => {
      const out = {};
      const walk = (x) => {
        for (const name of readdirSync(x)) {
          const p = join(x, name);
          if (statSync(p).isDirectory()) walk(p);
          else out[p.slice(d.length + 1).split('/').join('/')] = readFileSync(p, 'utf8');
        }
      };
      walk(d);
      return out;
    };
    const got = readTree(dir);
    const want = {};
    for (const [p, v] of Object.entries(c.files)) want[p] = v;
    for (const [p, v] of Object.entries(c.after)) {
      if (v === null) delete want[p];
      else want[p] = v;
    }
    for (const p of new Set([...Object.keys(want), ...Object.keys(got)])) {
      if (want[p] === undefined) why.push(`${p} should not exist`);
      else if (got[p] === undefined) why.push(`${p} is missing`);
      else if (got[p] !== want[p]) why.push(`${p} differs: expected ${JSON.stringify(want[p])}, got ${JSON.stringify(got[p])}`);
    }
    if (why.length === 0) passed += 1;
    else failed.push(`${c.name}\n  ${why.join('\n  ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
for (const f of failed) process.stdout.write(`FAIL ${f}\n`);
process.stdout.write(`${passed} of ${cases.length} passed\n`);
if (failed.length > 0) process.exitCode = 1;
