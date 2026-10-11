"""Render docs/engine-catalog.md: hand-written notes.md with generated tables spliced in."""

import collections
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def _table(rows, header):
    s = '| ' + ' | '.join(header) + ' |\n|' + '---|' * len(header) + '\n'
    for r in rows:
        s += '| ' + ' | '.join(str(x).replace('|', '\\|').replace('\n', ' ') for x in r) + ' |\n'
    return s


def render_md(out):
    E = out['entries']
    c = out['meta']['counts']
    parts = []
    areas = collections.OrderedDict()
    for e in E:
        areas.setdefault(e['area'], []).append(e)
    rows = []
    for a, es in sorted(areas.items(), key=lambda x: -len(x[1])):
        tc = collections.Counter(e['target']['summary'].split('(')[0].split(':')[0] for e in es)
        kc = collections.Counter(e['kind'] for e in es).most_common(5)
        cc = collections.Counter(e['content'] for e in es)
        rows.append([a, len(es), len(es) - cc.get('homebrew', 0), cc.get('homebrew', 0),
                     tc.get('explicit', 0), tc.get('each-player', 0), tc.get('implicit', 0) + tc.get('mixed', 0),
                     tc.get('unknown', 0), ', '.join(f'{k} {n}' for k, n in kc)])
    parts.append('### Handlers per area\n\n' + _table(rows, ['area', 'handlers', 'non-homebrew', 'homebrew', 'explicit target', 'each-player', 'implicit/mixed', 'unknown', 'top kinds']))
    rows = []
    for aid, a in out['agents'].items():
        es = [e for e in E if e['agent'] == aid]
        kinds = [k for k, v in out['kinds'].items() if v['agent'] == aid]
        nonhb = sum(1 for e in es if e['content'] != 'homebrew')
        rows.append([aid, a['name'], len(es), nonhb, ', '.join(kinds), a['scope']])
    parts.append('### Assignment table (11 area agents)\n\n' + _table(rows, ['agent', 'name', 'handlers', 'non-homebrew', 'owns kinds', 'scope']))
    rows = [[f'`{k}`', v['count'], v['agent'], f"`{v['option']}`", v['description']] for k, v in out['kinds'].items()]
    parts.append('### Decision kinds (proposed)\n\n' + _table(rows, ['kind', 'handlers', 'owner', 'option', 'meaning']))
    rows = [[k, v] for k, v in c['byTarget'].items()]
    parts.append('### Target-player resolution\n\n' + _table(rows, ['target.summary', 'handlers']))
    rows = [[k, v] for k, v in c['byContent'].items()]
    parts.append('### Content source\n\n' + _table(rows, ['content', 'handlers']))
    rows = [[p['kindHint'], f"{p['file'].split('/')[-1]}:{p['line']}", p['method'].split('.')[-1], p['text'][:90]]
            for p in out['textPrompts'] if p.get('keyPrompt')]
    parts.append('### Key text-only prompts\n\n' + _table(rows[:45], ['kind', 'where', 'method', 'text']))
    rows = [[u['pattern'], u['count'], u['example'][:110]] for u in out['unmatchedCreationSites'][:25]]
    parts.append('### Creation sites whose id could not be resolved to a handler (top 25)\n\n' + _table(rows, ['leading pattern', 'sites', 'example']))
    tables = '\n'.join(parts)
    tpl = open(os.path.join(HERE, 'notes.md')).read()
    stats = (f"{c['handlers']} handlers ({', '.join(f'{k} {v}' for k, v in c['byComponentType'].items())}); "
             f"{c['creationSites']} creation sites, {c['creationSitesMatched']} resolved to a handler; "
             f"{c['handlersWithCreationSite']} handlers with a resolved creation site, {c['handlersWithOnlyLiteralRefs']} found only via literal refs, "
             f"{c['handlersNeverReferenced']} never referenced (dead, or id built fully dynamically); {c['textPrompts']} text prompts. "
             f"Bot commit `{out['meta']['botCommit']}`.")
    return tpl.replace('<!-- STATS -->', stats).replace('<!-- TABLES -->', tables)
