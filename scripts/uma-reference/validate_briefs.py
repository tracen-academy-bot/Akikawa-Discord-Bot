"""Deterministic checks on every brief against its source file.

Usage: python3 -I validate_briefs.py <scratchpad_dir>
"""
import glob, json, os, re, sys

KEYS = ['id', 'name_en', 'name_jp', 'kind', 'one_liner', 'personality', 'speech',
        'likes_and_motifs', 'weak_spots', 'profile', 'relationships', 'groups',
        'story_arc', 'sample_lines', 'timer_line_ideas', 'data_gaps']
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿]')
norm = lambda s: re.sub(r'\s+', '', s or '')

sp = sys.argv[1]
problems, n = [], 0
for path in sorted(glob.glob(os.path.join(sp, 'data', 'chara', '*.json'))):
    cid = os.path.basename(path)[:-5]
    src = json.load(open(path, encoding='utf-8'))
    bp = os.path.join(sp, 'briefs', cid + '.json')
    try:
        b = json.load(open(bp, encoding='utf-8'))
    except Exception as e:
        problems.append(f'{cid}: unreadable brief ({e})'); continue
    n += 1
    miss = [k for k in KEYS if k not in b]
    if miss: problems.append(f'{cid}: missing keys {miss}')
    lines = {v['voice_id']: norm(v['text']) for v in src['voice_lines']}
    for s in b.get('sample_lines') or []:
        if lines.get(s.get('voice_id')) != norm(s.get('jp')):
            problems.append(f"{cid}: sample {s.get('voice_id')} not verbatim")
    for t in b.get('timer_line_ideas') or []:
        if t.count('{user}') != 1: problems.append(f'{cid}: timer line has {t.count("{user}")} {{user}}')
        if len(t) > 220: problems.append(f'{cid}: timer line {len(t)} chars')
        if EMOJI.search(t): problems.append(f'{cid}: timer line has emoji/symbol {EMOJI.findall(t)}')
    if src['voice_lines'] and not b.get('sample_lines'):
        problems.append(f'{cid}: has voice lines but no samples')
print(f'{n} briefs checked, {len(problems)} problems')
print('\n'.join(problems))
