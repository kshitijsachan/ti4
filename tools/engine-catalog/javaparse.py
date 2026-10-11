"""Tiny, regex-and-brace-matching Java reader for the AsyncTI4 source.

Not a real parser: it strips comments (keeping offsets), finds string literals,
method spans, static final String constants and call arguments. Good enough to
catalogue component ids; every heuristic here is documented in README.md.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field


def strip_comments(src: str) -> str:
    """Replace comments with spaces (newlines kept) so offsets/lines stay valid."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if src.startswith('"""', i):  # text block
            j = src.find('"""', i + 3)
            j = n if j < 0 else j + 3
            out.append(src[i:j])
            i = j
        elif c == '"' or c == "'":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                if j < n and src[j] == '\n':
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
        elif src.startswith('//', i):
            j = src.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(''.join(ch if ch == '\n' else ' ' for ch in src[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def skip_string(s: str, i: int) -> int:
    """i points at a quote; return index just past the literal."""
    q = s[i]
    if s.startswith('"""', i):
        j = s.find('"""', i + 3)
        return len(s) if j < 0 else j + 3
    j = i + 1
    while j < len(s) and s[j] != q:
        if s[j] == '\\':
            j += 1
        j += 1
    return j + 1


def match_brace(s: str, i: int, open_c='{', close_c='}') -> int:
    """i points at open_c; return index of matching close (or len)."""
    depth = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c in '"\'':
            i = skip_string(s, i)
            continue
        if c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n


def split_args(s: str, i: int) -> tuple[list[str], int]:
    """i points just after '('. Return (top-level args, index of closing paren)."""
    args, depth, start, n = [], 0, i, len(s)
    while i < n:
        c = s[i]
        if c in '"\'':
            i = skip_string(s, i)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                tail = s[start:i].strip()
                if tail or args:
                    args.append(tail)
                return args, i
            depth -= 1
        elif c == ',' and depth == 0:
            args.append(s[start:i].strip())
            start = i + 1
        elif c == '-' and i + 1 < n and s[i + 1] == '>' and depth == 0:
            pass
        i += 1
    return args, n


def split_plus(expr: str) -> list[str]:
    """Split an expression on top-level '+' (string concatenation)."""
    terms, depth, start, i, n = [], 0, 0, 0, len(expr)
    while i < n:
        c = expr[i]
        if c in '"\'':
            i = skip_string(expr, i)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        elif c == '?' and depth == 0:
            # ternary at top level: treat whole thing as one opaque term
            return [expr.strip()]
        elif c == '+' and depth == 0:
            if i + 1 < n and expr[i + 1] in '+=':
                i += 2
                continue
            terms.append(expr[start:i].strip())
            start = i + 1
        i += 1
    terms.append(expr[start:].strip())
    return [t for t in terms if t]


STRING_LIT = re.compile(r'^"((?:[^"\\]|\\.)*)"$')


def literal(term: str):
    m = STRING_LIT.match(term.strip())
    if m:
        return m.group(1).encode().decode('unicode_escape', errors='ignore') if '\\' in m.group(1) else m.group(1)
    return None


def line_of(src: str, off: int) -> int:
    return src.count('\n', 0, off) + 1


@dataclass
class Method:
    name: str
    ret: str
    params: str
    start: int  # offset of signature
    body_start: int
    body_end: int
    cls: str


@dataclass
class JavaFile:
    path: str  # relative to src/main/java
    raw: str
    src: str  # comment-stripped
    cls: str
    imports: dict = field(default_factory=dict)  # simple name -> fqcn
    methods: list = field(default_factory=list)
    consts: dict = field(default_factory=dict)  # NAME -> expr text

    def method_at(self, off: int):
        best = None
        for m in self.methods:
            if m.start <= off <= m.body_end:
                if best is None or m.start >= best.start:
                    best = m
        return best

    def line(self, off: int) -> int:
        return line_of(self.src, off)


METHOD_RE = re.compile(
    r'(?:(?:public|private|protected|static|final|synchronized|abstract|default)\s+)+'
    r'(?:<[^>]*>\s*)?([\w.<>\[\],?\s]+?)\s+(\w+)\s*\(', re.S)
CONST_RE = re.compile(r'(?:static\s+final|final\s+static|(?<!\()\bfinal(?=\s+String\s+[A-Z][A-Z0-9_]+\s*=))\s+String\s+(\w+)\s*=\s*', re.S)
CLASS_RE = re.compile(r'\b(?:class|interface|enum|record)\s+(\w+)')
IMPORT_RE = re.compile(r'^import\s+(static\s+)?([\w.]+)(\.\*)?;', re.M)


def parse_file(root: str, rel: str) -> JavaFile:
    raw = open(os.path.join(root, rel), encoding='utf-8', errors='replace').read()
    src = strip_comments(raw)
    m = CLASS_RE.search(src)
    cls = m.group(1) if m else os.path.basename(rel)[:-5]
    jf = JavaFile(rel, raw, src, cls)
    for im in IMPORT_RE.finditer(src):
        name = im.group(2)
        jf.imports[name.rsplit('.', 1)[-1]] = name
    for mm in METHOD_RE.finditer(src):
        ret, name = mm.group(1).strip(), mm.group(2)
        if name in ('if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else'):
            continue
        p_open = mm.end() - 1
        p_close = match_brace(src, p_open, '(', ')')
        k = p_close + 1
        rest = src[k:k + 300]
        tm = re.match(r'\s*(throws\s+[\w.,\s]+)?\s*([{;])', rest)
        if not tm or tm.group(2) != '{':
            continue
        b = k + tm.end() - 1
        e = match_brace(src, b)
        jf.methods.append(Method(name, ret, src[p_open + 1:p_close], mm.start(), b, e, cls))
    for cm in CONST_RE.finditer(src):
        j = cm.end()
        # read until top-level ';'
        depth, i = 0, j
        while i < len(src):
            c = src[i]
            if c in '"\'':
                i = skip_string(src, i)
                continue
            if c in '([{':
                depth += 1
            elif c in ')]}':
                depth -= 1
            elif c == ';' and depth <= 0:
                break
            i += 1
        jf.consts[cm.group(1)] = src[j:i].strip()
    return jf


def load_tree(root: str) -> list[JavaFile]:
    files = []
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.endswith('.java'):
                rel = os.path.relpath(os.path.join(d, f), root)
                files.append(parse_file(root, rel))
    files.sort(key=lambda f: f.path)
    return files
