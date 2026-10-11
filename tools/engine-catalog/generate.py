#!/usr/bin/env python3
"""Generate docs/engine-catalog.json from the AsyncTI4 bot source.

Usage:
  python3 tools/engine-catalog/generate.py [--bot /home/user/asyncti4/ti4_map_generator_bot] [--out docs/engine-catalog.json]

See tools/engine-catalog/README.md for the method and its limits.
"""

from __future__ import annotations

import argparse
import bisect
import collections
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from javaparse import load_tree  # noqa: E402
from extract import (OWNER_PLACEHOLDER, Index, caller_sends, extract, scan_creations)  # noqa: E402
import rules  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

PROMPT_RE = re.compile(
    r'(it is now your turn|your turn|is up next|up for an action|you are up|it is your|'
    r'please (vote|choose|select|decide|resolve|use|pick|discard|indicate|confirm)|'
    r'you (may|must|need to|have to|can now) (choose|decide|discard|pick|vote|select|use|score|resolve|assign|retreat|declare)|'
    r'(choose|select|pick|decide) (which|whether|a |an |the |how many)|'
    r'please (follow|react|respond)|has (played|been played)|use buttons to|use the buttons to|'
    r'waiting (on|for)|everyone|all players)', re.I)


def normalize(pattern: str):
    """Strip envelope markers. Returns (pattern, ownerKind)."""
    p = pattern.replace('deleteThisButton', '').replace('deleteThisMessage', '')
    owner = None
    if p.startswith(OWNER_PLACEHOLDER):
        p, owner = p[1:], 'ffcc'
    m = re.match(r'FFCC_(\{\w+\}|[a-z0-9]+)_', p)
    if m:
        p, owner = p[m.end():], 'ffcc'
    m = re.match(r'dummyPlayerSpoof(\{\w+\}|[a-z0-9]+)_', p)
    if m:
        p, owner = p[m.end():], 'spoof'
    return p.replace(OWNER_PLACEHOLDER, 'FFCC_{faction}_'), owner


def longest_key(keys_sorted, static):
    best = None
    for k in keys_sorted:
        if k and static.startswith(k) and (best is None or len(k) > len(best)):
            best = k
    return best


def site_mode(channels: set, owner, mentions):
    """Classify who a single creation site addresses."""
    if owner:
        return 'explicit:ffcc'
    if 'modal' in channels:
        return 'explicit:presser-modal'
    if 'ephemeral' in channels:
        return 'explicit:ephemeral-to-presser'
    if channels & {'privateThread', 'privateChannel'} and not channels & {'mainChannel', 'eventChannel', 'tableTalk'}:
        return 'explicit:private-thread'
    if channels & {'privateThread', 'privateChannel'}:
        return 'mixed:private-or-shared'
    if 'correctChannel' in channels or 'mainChannel' in channels:
        return 'implicit:actions-channel+mention' if mentions else 'implicit:actions-channel(anyone)'
    if 'editInPlace' in channels:
        return 'implicit:edit-in-place(inherits)'
    if 'eventChannel' in channels:
        return 'implicit:same-channel-as-press(inherits)'
    if 'threadOrDraftChannel' in channels:
        return 'implicit:thread'
    if 'tableTalk' in channels:
        return 'implicit:table-talk(anyone)'
    return 'unknown'


EACH_PLAYER_PREFIXES = re.compile(
    r'^(sc_follow_|sc_no_follow_|sc_follow|sc_trade_follow|sc_draw_so|sc_refresh|sc_ac_draw|preDeclineSC_|play_when|play_after|'
    r'no_when|no_after|queueWhen|queueAfter|queueAWhen|queueAnAfter|declineToQueue|passOnEverything|sabotage_|no_sabotage|'
    r'outcome_|exhaustForVotes_|resolveAgendaVote_|eraseMyVote|rider_|planetRider_|bidInfluence_|reviseBid|'
    r'scepterE_follow_|mahactA_follow_|thardentiag_follow_|nekroFollowTech|diploRefresh2|warfareBuild|construction_|anarchy\d*secondary|'
    r'lumiACdraw|acPing|combatSideBet_|combatDoubleOrBust_|endTurnWhenAllReactedTo_|moveAlongAfterAllHaveReactedToAC_|fleetLogWhenAllReactedTo_)')

GENERIC_KINDS = {'choosePlanet', 'chooseSystem', 'choosePlayer', 'chooseUnit', 'chooseAmount', 'chooseCard',
                 'confirm', 'textInput', 'chooseOption', 'resolveCardEffect', 'useLeader', 'acquireTechnology'}

HANDLER_USES = [
    ('tilePos', r'getTileByPosition\(|getTile\(\s*\w+\s*\)|TileHelper\.getTile'),
    ('planet', r'getUnitHolderFromPlanet\(|getPlanetsInfo\(\)\.get\(|Mapper\.getPlanet\(|\bplanet\w*\s*=\s*buttonID|getPlanet\('),
    ('player', r'getPlayerFromColorOrFaction\(|getPlayerByColorID|getPlayerFromFaction|getPlayer\('),
    ('unit', r'Units\.findUnitType|UnitType\.|Mapper\.getUnitKey|getUnitKey|unitKey|UnitKey'),
    ('number', r'Integer\.parseInt\(|Integer\.valueOf\('),
    ('actionCard', r'Mapper\.getActionCard\(|getActionCards\(\)\.get'),
    ('promissory', r'Mapper\.getPromissory'),
    ('tech', r'Mapper\.getTech\('),
    ('relic', r'Mapper\.getRelic\('),
    ('leader', r'getLeader\(|Mapper\.getLeader\('),
    ('objective', r'getRevealedPublicObjectives|Mapper\.getPublicObjective|Mapper\.getSecretObjective'),
    ('agenda', r'Mapper\.getAgenda\('),
    ('explore', r'Mapper\.getExplore\('),
]
EDITS_IN_PLACE = re.compile(r'editMessage|editOriginal|editMessageButtons|editComponents|deleteButtonAndDeleteMessageIfEmpty|editButton|getMessage\(\)\.edit')
ACTIVE_CHECK = re.compile(r'getActivePlayerID\(\)|getActivePlayer\(\)|isActivePlayer|game\.getSpeaker')
SPLIT_RE = re.compile(r'(?:buttonID|componentID|modalID|menuID|buttonId|id)\.(split|replace|substring|replaceFirst|startsWith|contains|equals|endsWith)\(\s*("(?:[^"\\]|\\.)*")?')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bot', default='/home/user/asyncti4/ti4_map_generator_bot')
    ap.add_argument('--out', default=os.path.join(REPO, 'docs', 'engine-catalog.json'))
    args = ap.parse_args()
    root = os.path.join(args.bot, 'src', 'main', 'java')
    try:
        bot_commit = subprocess.check_output(['git', '-C', args.bot, 'rev-parse', 'HEAD'], text=True).strip()
    except Exception:
        bot_commit = None

    files = load_tree(root)
    idx = Index(files)
    handlers = extract(idx)
    sites = scan_creations(idx)
    print(f'{len(files)} files, {len(handlers)} handlers, {len(sites)} creation sites', file=sys.stderr)

    keys = {'button': sorted({h['prefix'] for h in handlers if h['componentType'] == 'button' and h['prefix']}),
            'select': sorted({h['prefix'] for h in handlers if h['componentType'] == 'select' and h['prefix']}),
            'modal': sorted({h['prefix'] for h in handlers if h['componentType'] == 'modal' and h['prefix']})}
    by_key = collections.defaultdict(list)
    for h in handlers:
        by_key[(h['componentType'], h['prefix'])].append(h)

    caller_cache = {}
    site_by_handler = collections.defaultdict(list)
    unmatched = []
    for s in sites:
        pat, owner = normalize(s['pattern'])
        s['normPattern'], s['ownerKind'] = pat, owner
        static = pat.split('{', 1)[0]
        ctype = 'button' if s['componentType'] == 'button?' else s['componentType']
        k = longest_key(keys[ctype], static) if static else None
        # 'jmfA_' settings menus build select/modal ids that route through the same framework
        if k is None and ctype != 'button' and static:
            k = longest_key(keys['button'], static) if ctype == 'select' else None
        channels = set(s['send'])
        via_callers = False
        if (not channels or channels <= {'editInPlace'}) and s['returnsComponents'] and s['methodName']:
            if s['methodName'] not in caller_cache:
                caller_cache[s['methodName']] = caller_sends(idx, s['methodName'])
            ct, _ = caller_cache[s['methodName']]
            if ct:
                channels |= ct
                via_callers = True
        s['channels'] = sorted(channels)
        s['channelsViaCallers'] = via_callers
        s['mode'] = site_mode(channels, owner, s['mentions'])
        if k is None:
            unmatched.append(s)
        else:
            site_by_handler[(ctype, k)].append(s)

    # literal references for handlers without creation sites (ids built elsewhere / passed through)
    big = []
    offsets = []
    pos = 0
    for f in files:
        offsets.append(pos)
        big.append(f.src)
        pos += len(f.src) + 1
    bigsrc = '\n'.join(big)

    def where(off):
        i = bisect.bisect_right(offsets, off) - 1
        f = files[i]
        return f'{f.path}:{f.src.count(chr(10), 0, off - offsets[i]) + 1}'

    entries = []
    for h in handlers:
        key = (h['componentType'], h['prefix'])
        ss = site_by_handler.get(key, []) if h['prefix'] else []
        body = h['_body']
        pats = collections.Counter(s['normPattern'] for s in ss)
        fields = []
        for p, _ in pats.most_common():
            for fld in re.findall(r'\{(\w+)\}', p[len(h['prefix'] or ''):]):
                if fld not in fields:
                    fields.append(fld)
        modes = collections.Counter(s['mode'] for s in ss)
        owners = collections.Counter(s['ownerVar'] for s in ss if s['ownerVar'])
        channels = sorted({c for s in ss for c in s['channels']})
        refs = []
        if not ss and h['prefix'] and len(h['prefix']) >= 3:
            needle = '"' + h['prefix']
            start = 0
            while len(refs) < 5:
                i = bigsrc.find(needle, start)
                if i < 0:
                    break
                w = where(i)
                if not w.startswith(h['file'] + ':' + str(h['line'])):
                    refs.append(w)
                start = i + 1
            if not refs and not h['prefix'][0].islower() is False:
                pass
        uses = [name for name, pat in HANDLER_USES if re.search(pat, body)]
        parse_ops = []
        for m in SPLIT_RE.finditer(body):
            op = m.group(1) + ('(' + m.group(2) + ')' if m.group(2) else '')
            if op not in parse_ops:
                parse_ops.append(op)
        if h['prefix'] and EACH_PLAYER_PREFIXES.search(h['prefix']):
            target = 'each-player'
        elif not ss:
            target = 'unknown(no creation site found)'
        elif modes.get('explicit:ffcc', 0) == len(ss):
            target = 'explicit:ffcc'
        elif all(m.startswith('explicit') for m in modes):
            target = 'explicit:' + '+'.join(sorted({m.split(':', 1)[1] for m in modes}))
        elif any(m.startswith('explicit') for m in modes):
            target = 'mixed'
        else:
            target = modes.most_common(1)[0][0]
        area, area_rule = rules.match_area(h['prefix'], h['file'], h['method'])
        kind, kind_rule = rules.match_kind(h['prefix'], area, fields, h['method'])
        if kind == 'choosePlayer' and area == 'trade/transactions':
            kind = 'transaction'
        area_from_rules = area
        if kind not in GENERIC_KINDS and kind in rules.KINDS and rules.AREA_TO_AGENT.get(area) != rules.KINDS[kind][2]:
            area = rules.AGENT_AREA[rules.KINDS[kind][2]]
        entry = {
            'id': f"{h['componentType']}:{h['prefix']}",
            'componentType': h['componentType'],
            'prefix': h['prefix'],
            'prefixExpr': None if (h['prefixExpr'] or '').strip('" ') == h['prefix'] else h['prefixExpr'],
            'handler': {
                'class': h['class'], 'method': h['method'], 'file': h['file'], 'line': h['line'],
                'params': h['methodParams'], 'save': h['save'],
                'dispatch': 'SelectionManager (legacy Selection.accept)' if h.get('legacySelection') else
                f"@{ {'button': 'ButtonHandler', 'select': 'SelectionHandler', 'modal': 'ModalHandler'}[h['componentType']] } longest-prefix match",
                'parseOps': parse_ops[:8],
                'resolvesFromId': uses,
                'checksActivePlayer': bool(ACTIVE_CHECK.search(body)),
                'editsMessageInPlace': bool(EDITS_IN_PLACE.search(body)),
                'opensModal': 'replyModal(' in body,
                'readsLabel': bool(re.search(r'getButton\(\)\.getLabel\(\)|getLabel\(\)', body)),
                'readsMessageContent': bool(re.search(r'getMessage\(\)\.getContent|getContentRaw\(\)|getContentDisplay\(\)', body)),
                'usesStoredValues': bool(re.search(r'getStoredValue\(|setStoredValue\(', body)),
            },
            'grammar': {
                'patterns': [p for p, _ in pats.most_common(6)],
                'patternCount': len(pats),
                'fields': fields,
            },
            'createdAt': [f"{s['file']}:{s['line']}" for s in ss[:8]],
            'createdAtCount': len(ss),
            'createdIn': sorted({s['method'] for s in ss})[:8],
            'labels': sorted({s['label'] for s in ss if s['label']})[:6],
            'literalRefs': refs,
            'target': {
                'summary': target,
                'siteModes': dict(modes),
                'ownerVars': dict(owners),
                'channels': channels,
            },
            'area': area,
            'areaMatchedOn': area_rule,
            'areaBeforeKindOverride': area_from_rules if area_from_rules != area else None,
            'content': rules.match_content(h['file']),
            'kind': kind,
            'kindRule': kind_rule,
            'agent': (('A11' if rules.match_content(h['file']) == 'homebrew' else 'A10')
                      if area == 'faction/leaders (unclassified)' and kind in GENERIC_KINDS
                      else rules.AREA_TO_AGENT[area] if kind in GENERIC_KINDS else rules.KINDS[kind][2]),
        }
        entries.append(entry)

    entries.sort(key=lambda e: (e['agent'], e['area'], e['prefix'] or ''))

    # text-only prompts
    prompts = []
    for f in files:
        for m in re.finditer(r'MessageHelper\.(sendMessageToChannel|sendMessageToPlayerCardsInfoThread|sendPrivateMessageToPlayer|sendMessageToEventChannel)\(', f.src):
            seg = f.src[m.end():m.end() + 900]
            # first argument (channel) and literal text inside the call
            lits = re.findall(r'"((?:[^"\\]|\\.)*)"', seg.split(');', 1)[0])
            text = ' '.join(lits)
            if PROMPT_RE.search(text):
                meth = f.method_at(m.start())
                chan = seg.split(',', 1)[0].strip()
                prompts.append({'file': f.path, 'line': f.line(m.start()), 'method': (meth.cls + '.' + meth.name) if meth else f.cls,
                                'call': m.group(1), 'channel': chan[:80], 'text': text[:220],
                                'area': rules.match_area('', f.path, meth.name if meth else '')[0]})

    # key turn-structure prompts (often built into a String variable, so scan literals directly)
    key_prompts = [
        (r'it is now your turn', 'chooseTurnAction', 'Turn start: mention + start-of-turn buttons (StartTurnService.turnStart / getStartOfTurnButtons)'),
        (r'is up to pick their strategy card|please pick a strategy card|up to pick a strategy card', 'pickStrategyCard', 'Strategy phase: next picker pinged; scPick_ buttons (FFCC to picker)'),
        (r'up to vote', 'castVotes', 'Agenda voting: next voter pinged; outcome/planet vote buttons'),
        (r'Please score objectives', 'scoreObjective', 'Status phase scoring prompt (everyone, in parallel)'),
        (r'will start their turn once', 'chooseTurnAction', 'Next-player heads-up appended to turn start'),
        (r'Use buttons to do your turn', 'chooseTurnAction', 'Text attached to the start-of-turn button message'),
        (r'when.?s? and .?afters?|whens?/afters?', 'whenAfterWindow', 'Agenda when/after window text'),
        (r'(has|have) played .*(strategy card|\*\*)|to follow|follow or not', 'followStrategyCard', 'SC played: every other player follows/declines'),
    ]
    for f in files:
        for lm in re.finditer(r'"((?:[^"\\]|\\.)*)"', f.src):
            txt = lm.group(1)
            for pat, kind_hint, note in key_prompts:
                if re.search(pat, txt, re.I):
                    meth = f.method_at(lm.start())
                    prompts.append({'file': f.path, 'line': f.line(lm.start()),
                                    'method': (meth.cls + '.' + meth.name) if meth else f.cls,
                                    'call': 'literal', 'channel': None, 'text': txt[:220],
                                    'area': rules.match_area('', f.path, meth.name if meth else '')[0],
                                    'keyPrompt': True, 'kindHint': kind_hint, 'note': note})
                    break

    # dynamic / unmatched creation sites summary
    um = collections.Counter()
    um_examples = {}
    for s in unmatched:
        k = s['normPattern'].split('}', 1)[0] + '}' if s['normPattern'].startswith('{') else s['normPattern'][:30]
        um[k] += 1
        um_examples.setdefault(k, f"{s['file']}:{s['line']} {s['idExpr'][:120]}")

    counts = {
        'handlers': len(entries),
        'byComponentType': dict(collections.Counter(e['componentType'] for e in entries)),
        'byArea': dict(collections.Counter(e['area'] for e in entries).most_common()),
        'byAgent': dict(sorted(collections.Counter(e['agent'] for e in entries).items())),
        'byKind': dict(collections.Counter(e['kind'] for e in entries).most_common()),
        'byContent': dict(collections.Counter(e['content'] for e in entries).most_common()),
        'byTarget': dict(collections.Counter(e['target']['summary'] for e in entries).most_common()),
        'creationSites': len(sites),
        'creationSitesMatched': len(sites) - len(unmatched),
        'creationSitesUnmatched': len(unmatched),
        'handlersWithCreationSite': sum(1 for e in entries if e['createdAtCount']),
        'handlersWithOnlyLiteralRefs': sum(1 for e in entries if not e['createdAtCount'] and e['literalRefs']),
        'handlersNeverReferenced': sum(1 for e in entries if not e['createdAtCount'] and not e['literalRefs']),
        'textPrompts': len(prompts),
    }
    out = {
        'meta': {
            'generator': 'tools/engine-catalog/generate.py',
            'botSource': args.bot,
            'botCommit': bot_commit,
            'dispatch': {
                'buttons': 'ButtonListener -> ButtonProcessor.queue: HandlerRegistry.resolve(customId) = longest registered @ButtonHandler(value) that is a prefix of the id after ComponentIdEnvelope.decode strips FFCC_<faction>_ / dummyPlayerSpoof<faction>_ and deleteThisButton/deleteThisMessage markers. Unmatched -> "We couldn\'t resolve what to do with this button."',
                'selects': 'SelectionMenuListener -> SelectionMenuProcessor: same registry over @SelectionHandler, then legacy SelectionManager (Selection.accept) list.',
                'modals': 'ModalListener: registry over @ModalHandler, then hard-coded jmfA_ settings-framework fallback (MiltySettings / DraftSystemSettings / Franken / BaseGameMiniMilty parseInput).',
                'ownership': 'ListenerContext.isPressedByOwner: FFCC_<faction>_ ids may only be pressed by that faction (firmament<->obsidian and Onyxxa granted holders excepted); others get "these buttons are for someone else". dummyPlayerSpoof<faction>_ makes the press act as that (NPC/dummy) player. Non-players are rejected except showGameAgain and combat-replay bets.',
                'handlerParams': 'Handlers receive (event, Game, Player presser, String componentId, MessageChannel, ...) by reflection; @ButtonHandler(save=false) takes a read lock and skips save.',
            },
            'fieldLegend': {
                'grammar.patterns': 'creation-site id expressions rendered with {placeholders}; placeholder names are guessed from the Java expression (tilePos, planet, faction, color, unit, n, sc, tech, leader, relic, pn, ac, so, objective, agenda, cardId, token, userId, messageId, player, type, or the variable name). FFCC_{faction}_ owner prefix removed (see target).',
                'target.summary': 'explicit:ffcc = every creation site prefixes FFCC_<owner>_; explicit:private-thread / ephemeral-to-presser / presser-modal; each-player = reaction/follow/vote window every player answers; implicit:* = posted to a shared channel with no owner check (actions channel + mention, same channel as the press, edit-in-place); mixed = some sites explicit; unknown = no creation site resolved.',
                'target.ownerVars': 'Java receiver of factionButtonChecker() at creation sites (player = the actor in that method; target/opponent/p2 = someone else is being asked).',
                'handler.resolvesFromId': 'lookups the handler body performs (tile by position, planet unit holder, player from colour/faction, parseInt...) - evidence of encoded fields.',
                'kind': 'proposed typed decision kind (see kinds); kindRule says which rule fired: prefix:* (hand rule), fields (grammar), area-default (weak).',
            },
            'counts': counts,
        },
        'agents': {k: {'name': v[0], 'scope': v[1]} for k, v in rules.AGENTS.items()},
        'kinds': {k: {'description': v[0], 'option': v[1], 'agent': v[2],
                      'count': counts['byKind'].get(k, 0)} for k, v in rules.KINDS.items()},
        'entries': entries,
        'textPrompts': prompts,
        'unmatchedCreationSites': [{'pattern': k, 'count': v, 'example': um_examples[k]} for k, v in um.most_common(150)],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    from render_md import render_md
    with open(os.path.join(os.path.dirname(args.out), 'engine-catalog.md'), 'w') as fh:
        fh.write(render_md(out))
    print(json.dumps(counts, indent=1), file=sys.stderr)


if __name__ == '__main__':
    main()
