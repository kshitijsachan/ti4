"""Extract handlers, creation sites, id grammars and targeting from the AsyncTI4 bot source."""

from __future__ import annotations

import re
from collections import defaultdict

from javaparse import (JavaFile, literal, match_brace, skip_string, split_args, split_plus)

ANNOT_RE = re.compile(r'@(ButtonHandler|SelectionHandler|ModalHandler)\(')
CREATE_RE = re.compile(
    r'\b(?:Buttons\.(green|red|blue|gray)|Button\.(success|danger|primary|secondary|of)'
    r'|(StringSelectMenu)\.create|(EntitySelectMenu)\.create|(Modal)\.create)\(')
CHECKER_RE = re.compile(r'([\w.()]+?)\.(?:factionButtonChecker|getFactionCheckerPrefix|dummyPlayerSpoof)\(\)')
OWNER_PLACEHOLDER = '\u0001'  # marks FFCC_<owner>_ in rendered patterns


class Index:
    def __init__(self, files: list[JavaFile]):
        self.files = files
        self.by_class = defaultdict(list)
        self.const_by_name = defaultdict(list)
        self.methods_by_name = defaultdict(list)
        for f in files:
            self.by_class[f.cls].append(f)
            # nested classes: register every class name declared in file
            for m in re.finditer(r'\b(?:class|interface|enum|record)\s+(\w+)', f.src):
                if f not in self.by_class[m.group(1)]:
                    self.by_class[m.group(1)].append(f)
            for k in f.consts:
                self.const_by_name[k].append(f)
            for m in f.methods:
                self.methods_by_name[m.name].append((f, m))
        self._cache = {}

    # ---------- constant resolution ----------
    def resolve_const(self, name: str, jf: JavaFile, depth=0):
        """Return resolved literal string for constant reference `name` seen in `jf`, or None."""
        key = (name, jf.path)
        if key in self._cache:
            return self._cache[key]
        self._cache[key] = None
        val = None
        if depth < 6:
            if '.' in name:
                cls, cname = name.rsplit('.', 1)
                cls = cls.rsplit('.', 1)[-1]
                for f in self.by_class.get(cls, []):
                    if cname in f.consts:
                        val = self.resolve_expr_literal(f.consts[cname], f, depth + 1)
                        break
            else:
                if name in jf.consts:
                    val = self.resolve_expr_literal(jf.consts[name], jf, depth + 1)
                else:
                    cands = self.const_by_name.get(name, [])
                    # prefer static import
                    for f in cands:
                        fq = jf.imports.get(name)
                        if fq and fq.rsplit('.', 1)[0].endswith(f.cls):
                            val = self.resolve_expr_literal(f.consts[name], f, depth + 1)
                            break
                    if val is None:
                        vals = {self.resolve_expr_literal(f.consts[name], f, depth + 1) for f in cands}
                        vals.discard(None)
                        if len(vals) == 1:
                            val = vals.pop()
        self._cache[key] = val
        return val

    def resolve_expr_literal(self, expr: str, jf: JavaFile, depth=0):
        parts = []
        for t in split_plus(expr):
            lit = literal(t)
            if lit is None:
                if re.fullmatch(r'[\w.]+', t) and not t[0].isdigit():
                    lit = self.resolve_const(t, jf, depth)
                elif re.fullmatch(r"'(.)'", t):
                    lit = t[1]
            if lit is None:
                return None
            parts.append(lit)
        return ''.join(parts)

    # ---------- id-expression rendering ----------
    def render(self, expr: str, jf: JavaFile, method, depth=0, seen=None):
        """Render an id expression to a pattern string with {placeholders}.

        Returns (pattern, owner_var) where owner_var is the receiver of factionButtonChecker()
        if the id carries the FFCC_<faction>_ owner prefix."""
        seen = seen or set()
        out = []
        owner = None
        for t in split_plus(expr):
            t = t.strip()
            while t.startswith('(') and t.endswith(')') and match_brace(t, 0, '(', ')') == len(t) - 1:
                t = t[1:-1].strip()
            lit = literal(t)
            if lit is not None:
                out.append(lit)
                continue
            cm = re.fullmatch(r'([\w.()\[\]]+?)\.(factionButtonChecker|getFactionCheckerPrefix|dummyPlayerSpoof)\(\)', t)
            if cm:
                owner = cm.group(1)
                out.append(OWNER_PLACEHOLDER)
                continue
            om = re.fullmatch(r'ComponentIdEnvelope\.ownedBy\((.*)\)', t, re.S)
            if om:
                owner = om.group(1)
                out.append(OWNER_PLACEHOLDER)
                continue
            if re.fullmatch(r'[A-Za-z_][\w.]*', t) and (t.isupper() or '.' in t and t.rsplit('.', 1)[1].isupper()
                                                        or re.fullmatch(r'[A-Z][A-Z0-9_]*', t.rsplit('.', 1)[-1])):
                v = self.resolve_const(t, jf)
                if v is not None:
                    out.append(v)
                    continue
            # local String variable assigned in the same method
            if method is not None and re.fullmatch(r'[a-z]\w*', t) and depth < 3 and t not in seen:
                body = jf.src[method.start:method.body_end]
                am = re.search(r'\bString\s+' + t + r'\s*=\s*', body) or re.search(r'(?<![\w.])' + t + r'\s*=\s*(?!=)', body)
                if am:
                    e = _read_expr(body, am.end())
                    if '"' in e or 'factionButtonChecker' in e or re.search(r'\b[A-Z][A-Z0-9_]{2,}\b', e):
                        p, o = self.render(e, jf, method, depth + 1, seen | {t})
                        out.append(p)
                        owner = owner or o
                        continue
            # method parameter: resolve from literal arguments at call sites of this method
            if method is not None and re.fullmatch(r'[a-z]\w*', t) and depth < 2 and t not in seen:
                pnames = [re.sub(r'.*\s', '', p.strip()) for p in split_args(method.params + ')', 0)[0]]
                if t in pnames:
                    r = self._from_callers(method, pnames.index(t), depth, seen | {t})
                    if r is not None:
                        out.append(r[0])
                        owner = owner or r[1]
                        continue
            # static String-returning helper with a single return expression
            mm = re.fullmatch(r'(?:([A-Z]\w*)\.)?(\w+)\((.*)\)', t, re.S)
            if mm and depth < 3:
                inl = self._inline_call(mm.group(1), mm.group(2), jf)
                if inl is not None:
                    f2, m2, rexpr = inl
                    p, o = self.render(rexpr, f2, m2, depth + 1, seen)
                    if '{' not in p[:1] or len(p) > 1:
                        out.append(p)
                        owner = owner or o
                        continue
            out.append('{' + placeholder_name(t) + '}')
        return ''.join(out), owner

    def _from_callers(self, method, argi, depth, seen):
        key = ('callers', method.cls, method.name, argi)
        if key in self._cache:
            return self._cache[key]
        self._cache[key] = None
        pat = re.compile(r'(?<![\w])' + re.escape(method.name) + r'\(')
        found = []
        for f in self.files:
            if method.name + '(' not in f.src:
                continue
            for m in pat.finditer(f.src):
                caller = f.method_at(m.start())
                if caller is None or caller.start == method.start:
                    continue
                args, _ = split_args(f.src, m.end())
                if argi < len(args):
                    p, o = self.render(args[argi], f, caller, depth + 1, seen)
                    if p and not p.startswith('{'):
                        found.append((p, o))
                if len(found) >= 3:
                    break
            if len(found) >= 3:
                break
        res = found[0] if found else None
        self._cache[key] = res
        return res

    def _inline_call(self, cls, name, jf):
        cands = self.methods_by_name.get(name, [])
        if cls:
            cands = [(f, m) for f, m in cands if m.cls == cls or f.cls == cls]
        else:
            cands = [(f, m) for f, m in cands if f is jf] or []
        for f, m in cands[:1]:
            if 'String' not in m.ret:
                return None
            body = f.src[m.body_start + 1:m.body_end].strip()
            rm = re.fullmatch(r'return\s+(.*);', body, re.S)
            if rm:
                return f, m, rm.group(1)
        return None


def _read_expr(s: str, i: int) -> str:
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c in '"\'':
            j = skip_string(s, j)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            if depth == 0:
                break
            depth -= 1
        elif c in ';,' and depth == 0:
            break
        j += 1
    return s[i:j].strip()


PLACEHOLDER_RULES = [
    (r'getposition|\bpos\b|position|tilepos|\bpos\d|tile\.get|tileid|activesystem', 'tilePos'),
    (r'planet', 'planet'),
    (r'getfaction|faction', 'faction'),
    (r'getcolor|color', 'color'),
    (r'unittype|unitkey|\bunit|asyncid|getunit', 'unit'),
    (r'\bsc\b|strategycard|scnum|scnumber|getsc|\bsc\d', 'sc'),
    (r'tech', 'tech'),
    (r'leader|agent|commander|hero', 'leader'),
    (r'relic', 'relic'),
    (r'\bpn\b|promissory|pnid', 'pn'),
    (r'\bac\b|actioncard|acid|acalias', 'ac'),
    (r'\bso\b|secret|soid', 'so'),
    (r'objective|\bpo\b|poid', 'objective'),
    (r'agenda', 'agenda'),
    (r'explore|card|cardid', 'cardId'),
    (r'token|attachment', 'token'),
    (r'userid|getuserid', 'userId'),
    (r'messageid|getmessageid', 'messageId'),
    (r'amount|count|num|\bi\b|\bx\b|votes|tg|comms|cost|\d|size|index|round|hits|dice', 'n'),
    (r'player|p2|p1|target|opponent|owner', 'player'),
    (r'type|kind|deck', 'type'),
]


def placeholder_name(term: str) -> str:
    t = term.lower()
    for pat, name in PLACEHOLDER_RULES:
        if re.search(pat, t):
            return name
    ident = re.sub(r'[^\w]', '', term.split('(')[0].split('.')[-1])[:24]
    return ident or 'x'


SEND_RULES = [
    ('modal', r'replyModal\('),
    ('ephemeral', r'Ephemeral|setEphemeral\(true\)'),
    ('privateThread', r'getCardsInfoThread\(\)|sendMessageToPlayerCardsInfoThread|EmbedsToCardsInfoThread'),
    ('privateChannel', r'getPrivateChannel\(\)|sendPrivateMessageToPlayer|sendMessageToUser'),
    ('correctChannel', r'getCorrectChannel\(\)'),
    ('mainChannel', r'getMainGameChannel\(\)|getActionsChannel\(\)|mainGameChannel'),
    ('tableTalk', r'getTableTalkChannel\(\)'),
    ('eventChannel', r'event\.getMessageChannel\(\)|event\.getChannel\(\)|sendMessageToEventChannel|replyToMessage\(|getMessageChannel\(\)'),
    ('editInPlace', r'editMessage|editOriginal|editMessageButtons|editMessageWithButtons|editComponents|postOrEditWithButtons'),
    ('threadOrDraftChannel', r'sendMessageToThread|getThreadChannel|Thread\(\)|draftChannel|getDraftChannel'),
]
MENTION_RE = re.compile(r'getRepresentationUnfogged\(\)|getRepresentation\(\)|getPing\(\)|getAsMention\(\)|getRepresentation\(true')


def send_targets(body: str) -> set[str]:
    return {name for name, pat in SEND_RULES if re.search(pat, body)}


ADMIN_RE = re.compile(r'testbed|bothelper|admin|lore|jimbo|fowSetup|gmSetup|matchmaking|combatReplay|sideBet|doubleOrBust', re.I)


def extract(index: Index):
    handlers = []
    for f in index.files:
        for am in ANNOT_RE.finditer(f.src):
            args, close = split_args(f.src, am.end())
            val_expr, save = None, True
            for a in args:
                kv = re.match(r'(\w+)\s*=\s*(.*)', a, re.S)
                if kv and kv.group(1) == 'value':
                    val_expr = kv.group(2)
                elif kv and kv.group(1) == 'save':
                    save = kv.group(2).strip() != 'false'
                elif not kv:
                    val_expr = a
            value = index.resolve_expr_literal(val_expr, f) if val_expr else None
            meth = next((m for m in f.methods if m.start > close), None)
            body = f.src[meth.body_start:meth.body_end] if meth else ''
            handlers.append({
                'componentType': {'ButtonHandler': 'button', 'SelectionHandler': 'select',
                                  'ModalHandler': 'modal'}[am.group(1)],
                'prefix': value,
                'prefixExpr': val_expr,
                'save': save,
                'file': f.path,
                'line': f.line(am.start()),
                'class': f.cls,
                'method': meth.name if meth else None,
                'methodParams': re.sub(r'\s+', ' ', meth.params.strip()) if meth else '',
                '_body': body,
                '_file': f,
            })
    # legacy Selection classes (SelectionManager)
    for f in index.files:
        if re.search(r'implements\s+Selection\b', f.src):
            m = re.search(r'getSelectionID\(\)\s*\{\s*return\s+([^;]+);', f.src)
            if m:
                v = index.resolve_expr_literal(m.group(1), f)
                handlers.append({'componentType': 'select', 'prefix': v, 'prefixExpr': m.group(1), 'save': True,
                                 'file': f.path, 'line': f.line(m.start()), 'class': f.cls, 'method': 'execute',
                                 'methodParams': '', '_body': f.src, '_file': f, 'legacySelection': True})
    return handlers


def scan_creations(index: Index):
    sites = []
    for f in index.files:
        for cm in CREATE_RE.finditer(f.src):
            ctype = 'modal' if cm.group(5) else ('select' if (cm.group(3) or cm.group(4)) else 'button')
            args, close = split_args(f.src, cm.end())
            if not args:
                continue
            idx = 1 if cm.group(2) == 'of' else 0  # Button.of(style, id, label)
            if idx >= len(args):
                continue
            id_expr = args[idx]
            label_expr = args[idx + 1] if len(args) > idx + 1 else ''
            sites.append(_site(index, f, cm.start(), ctype, id_expr, label_expr))
        # other id expressions: X.factionButtonChecker() + ... not inside a Buttons.* call
        for m in re.finditer(r'(?<![\w.])[A-Za-z_]\w*(?:\(\))?(?:\.[A-Za-z_]\w*(?:\(\))?)*\.factionButtonChecker\(\)\s*\+', f.src):
            pre = f.src[max(0, m.start() - 40):m.start()]
            if re.search(r'(Buttons\.(green|red|blue|gray)|Button\.\w+|StringSelectMenu\.create|Modal\.create)\(\s*$', pre):
                continue
            e = _read_expr(f.src, m.start())
            sites.append(_site(index, f, m.start(), 'button?', e, ''))
    return sites


def _site(index, f, off, ctype, id_expr, label_expr):
    meth = f.method_at(off)
    pattern, owner = index.render(id_expr, f, meth)
    label = literal(label_expr.strip()) if label_expr else None
    if label is None and label_expr:
        lp = [literal(t) for t in split_plus(label_expr)]
        label = ''.join(x if x is not None else '…' for x in lp)[:80] if any(lp) else None
    body = f.src[meth.body_start:meth.body_end] if meth else ''
    return {
        'componentType': ctype,
        'file': f.path,
        'line': f.line(off),
        'method': (meth.cls + '.' + meth.name) if meth else f.cls,
        'methodName': meth.name if meth else None,
        'returnsComponents': bool(meth and re.search(r'Button|ActionRow|SelectMenu|Modal|Component', meth.ret)),
        'pattern': pattern,
        'ownerVar': owner,
        'label': label,
        'idExpr': re.sub(r'\s+', ' ', id_expr)[:200],
        'send': sorted(_sends_for(f, off, meth, body)),
        'sendPrecise': bool(_precise_sends(f, off, meth)),
        'mentions': bool(MENTION_RE.search(body)),
    }


def _sends_for(f, off, meth, body):
    p = _precise_sends(f, off, meth)
    if p and all(x.startswith('channelParam:') for x in p):
        return p | send_targets(body)
    return p or send_targets(body)


SEND_CALL_RE = re.compile(r'(MessageHelper\.\w+|\.replyModal|editMessageWithButtons|editMessageButtons|setComponents|sendMessage)\(')


def _precise_sends(f, off, meth):
    """Channels of the send calls that actually carry the list/variable this component is added to."""
    if meth is None:
        return set()
    ls = f.src.rfind('\n', 0, off) + 1
    stmt = f.src[max(meth.body_start, ls - 200):off]
    m = re.search(r'(\w+)\.add(?:All)?\(\s*$', stmt) or re.search(r'(\w+)\s*=\s*(?:List\.of|Arrays\.asList|new ArrayList<>\(List\.of)?\(?\s*$', stmt) \
        or re.search(r'(\w+)\.add\(\s*\w+,\s*$', stmt)
    if not m:
        m2 = re.search(r'(?:Button|Modal|StringSelectMenu)\s+(\w+)\s*=\s*$', stmt)
        if not m2:
            return set()
        m = m2
    var = m.group(1)
    if var in ('buttons', 'list') and False:
        return set()
    body = f.src[meth.body_start:meth.body_end]
    out = set()
    for cm in SEND_CALL_RE.finditer(body):
        args, _ = split_args(body, cm.end())
        if any(re.search(r'(?<![\w.])' + re.escape(var) + r'(?![\w(])', a) for a in args):
            call = cm.group(0) + ' '.join(args[:1])
            t = send_targets(call)
            if 'replyModal' in call:
                t.add('modal')
            if not t and args:
                # first arg is a channel variable: classify by its assignment in the method
                ch = args[0]
                am = re.search(re.escape(ch) + r'\s*=\s*([^;]+);', body) if re.fullmatch(r'\w+', ch) else None
                t = send_targets(am.group(1)) if am else set()
                if not t and re.fullmatch(r'\w+', ch):
                    t = {'channelParam:' + ch}
            out |= t
    if not out and re.search(r'return\s+' + re.escape(var) + r'\s*;', body):
        return set()
    return out


def caller_sends(index: Index, method_name: str, depth=0, seen=None):
    """Send targets of methods that call `method_name` (one or two levels up)."""
    seen = seen or set()
    if method_name in seen or depth > 1:
        return set(), set()
    seen.add(method_name)
    targets, callers = set(), set()
    pat = re.compile(r'(?<![\w])' + re.escape(method_name) + r'\(')
    for f in index.files:
        if method_name not in f.src:
            continue
        for m in pat.finditer(f.src):
            meth = f.method_at(m.start())
            if not meth or meth.name == method_name:
                continue
            body = f.src[meth.body_start:meth.body_end]
            t = send_targets(body)
            callers.add(meth.cls + '.' + meth.name)
            if t:
                targets |= t
            elif re.search(r'Button|ActionRow|Component', meth.ret):
                t2, _ = caller_sends(index, meth.name, depth + 1, seen)
                targets |= t2
    return targets, callers
