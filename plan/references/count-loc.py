#!/usr/bin/env python3
"""LOC counter that follows cloc's definitions (blank / comment-only / code lines).
Used for task 5.8 because cloc itself could not be installed (no network). Run from the repo root:
    python3 plan/references/count-loc.py [--files]
Excludes node_modules, dist, lockfiles, plan/, README and other prose."""
import os, re, sys, collections

SKIP_DIRS = {'node_modules', 'dist', '.git', 'plan'}
SKIP_FILES = {'package-lock.json', '.gitkeep'}
LANG = {'.js': 'JS', '.mjs': 'JS', '.jsx': 'JSX', '.css': 'CSS', '.sql': 'SQL',
        '.yaml': 'YAML', '.yml': 'YAML', '.json': 'JSON', '.html': 'HTML'}

def count(path, ext):
    blank = comment = code = 0
    in_block = False
    line_c = {'.sql': '--', '.yaml': '#', '.yml': '#'}.get(ext, '//' if ext in ('.js', '.mjs', '.jsx') else None)
    block = ext in ('.js', '.mjs', '.jsx', '.css', '.sql')
    for raw in open(path, encoding='utf-8', errors='replace'):
        s = raw.strip()
        if not s:
            blank += 1; continue
        if in_block:
            comment += 1
            if '*/' in s:
                in_block = False
                rest = s.split('*/', 1)[1].strip()
                if rest:  # code after the comment closes on the same line
                    comment -= 1; code += 1
            continue
        if line_c and s.startswith(line_c):
            comment += 1; continue
        if block and s.startswith('/*'):
            if '*/' in s:
                rest = s.split('*/', 1)[1].strip()
                if rest: code += 1
                else: comment += 1
            else:
                in_block = True; comment += 1
            continue
        if ext == '.jsx' and re.fullmatch(r'\{/\*.*\*/\}', s):
            comment += 1; continue
        code += 1
    return blank, comment, code

def area(rel):
    p = rel.split(os.sep)
    ext = os.path.splitext(rel)[1]
    if ext in ('.json', '.yaml', '.yml', '.html'): return 'Config'
    if p[0] == 'backend':
        if p[1] in ('tests', 'test-support'): return 'Backend tests'
        return 'Backend source'
    if p[0] == 'frontend':
        if p[1] == 'tests': return 'Frontend tests'
        if p[1] == 'src': return 'Frontend CSS' if ext == '.css' else 'Frontend source'
        return 'Config'
    if p[0] == 'database': return 'SQL migrations'
    return 'Config'

rows = []
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        ext = os.path.splitext(f)[1]
        if f in SKIP_FILES or ext not in LANG: continue
        if f.startswith('.env') : continue
        path = os.path.join(root, f); rel = os.path.relpath(path, '.')
        b, c, k = count(path, ext)
        rows.append((rel, LANG[ext], area(rel), b, c, k))

def table(title, key):
    agg = collections.OrderedDict()
    for r in rows:
        a = agg.setdefault(key(r), [0, 0, 0, 0]); a[0] += 1; a[1] += r[3]; a[2] += r[4]; a[3] += r[5]
    print(f'\n{title}\n{"":-<62}\n{"":28}{"files":>6}{"blank":>8}{"comment":>9}{"code":>8}')
    for k, v in sorted(agg.items(), key=lambda kv: -kv[1][3]): print(f'{k:28}{v[0]:>6}{v[1]:>8}{v[2]:>9}{v[3]:>8}')
    print(f'{"TOTAL":28}{sum(v[0] for v in agg.values()):>6}{sum(v[1] for v in agg.values()):>8}{sum(v[2] for v in agg.values()):>9}{sum(v[3] for v in agg.values()):>8}')

table('By language', lambda r: r[1])
table('By area', lambda r: r[2])
if '--files' in sys.argv:
    print()
    for r in sorted(rows, key=lambda r: -r[5])[:25]: print(f'{r[5]:>6}  {r[0]}')
