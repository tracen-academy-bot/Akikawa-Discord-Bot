"""Extract a per-character reference dataset from a JP Uma Musume master.mdb.

Usage:
    python3 -I extract_umas.py <master.mdb> <out_dir>

Writes:
    <out_dir>/chara/<id>.json  one file per named character (umas and NPCs)
    <out_dir>/index.json       compact roster (id, names, flags)
    <out_dir>/graph.json       interaction edges (home pairs, mentions, affinity)

Every value comes straight from the master tables. Nothing is translated or
inferred here; interpretation is left to later stages.
"""

import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict

# text_data categories holding per-character profile fields (index = chara id).
PROFILE_CATEGORIES = {
    'name_jp': 6,
    'voice_actor': 7,
    'dorm': 8,
    'tagline': 144,
    'birthday': 157,
    'height': 158,
    'grade': 162,
    'self_intro': 163,
    'strengths': 164,
    'weaknesses': 165,
    'about_ears': 166,
    'about_tail': 167,
    'shoe_size': 168,
    'about_family': 169,
    'name_en': 372,
    'short_name': 376,
}
# Six more trivia fields whose exact in-game labels are not stored in the mdb.
TRIVIA_CATEGORIES = [258, 259, 260, 261, 262, 263]

CAT_CARD_TITLE = 5          # card id -> epithet, e.g. [スペシャルドリーマー]
CAT_EVENT_TITLE = 181       # story id -> training event title
CAT_CHARA_STORY_TITLE = 92  # story id -> character story episode title

APTITUDE_GRADES = {1: 'G', 2: 'F', 3: 'E', 4: 'D', 5: 'C', 6: 'B', 7: 'A', 8: 'S'}
VOICE_SCENES = {
    0: 'title', 1: 'home', 2: 'training', 3: 'race_result', 4: 'live',
    7: 'outing_or_misc', 8: 'race_or_team', 9: 'minigame', 10: 'team_race',
}


def clean(text):
    """Normalise in-game line breaks to plain newlines."""
    if text is None:
        return None
    return text.replace('\r\n', '\n').replace('\r', '\n').replace('\\n', '\n').strip()


def main(mdb_path, out_dir):
    """Run the extraction."""
    conn = sqlite3.connect(f'file:{mdb_path}?mode=ro', uri=True)
    q = lambda sql, args=(): conn.execute(sql, args).fetchall()

    text = defaultdict(dict)
    for cat, idx, val in q('select category, "index", text from text_data'):
        text[cat][idx] = clean(val)

    chara_rows = {r[0]: r for r in q(
        'select id, chara_category, start_date, image_color_main, '
        'birth_year, height, bust from chara_data')}
    ids = sorted(text[6])

    # Cards (playable outfits) and their base aptitudes.
    cards = defaultdict(list)
    for card_id, chara_id, rarity, style in q(
            'select id, chara_id, default_rarity, running_style from card_data'):
        apt = q('select proper_distance_short, proper_distance_mile, '
                'proper_distance_middle, proper_distance_long, '
                'proper_running_style_nige, proper_running_style_senko, '
                'proper_running_style_sashi, proper_running_style_oikomi, '
                'proper_ground_turf, proper_ground_dirt from card_rarity_data '
                'where card_id=? order by rarity limit 1', (card_id,))
        keys = ['short', 'mile', 'medium', 'long', 'front', 'pace', 'late',
                'end', 'turf', 'dirt']
        cards[chara_id].append({
            'card_id': card_id,
            'title': text[CAT_CARD_TITLE].get(card_id),
            'default_rarity': rarity,
            'aptitudes': ({k: APTITUDE_GRADES.get(v, v) for k, v in zip(keys, apt[0])}
                          if apt else None),
        })
    support_cards = Counter(r[0] for r in q('select chara_id from support_card_data'))

    # Voice lines.
    voices = defaultdict(list)
    seen = defaultdict(set)
    for cid, vid, scene, val in q(
            'select character_id, voice_id, scene, text from character_system_text '
            'where text != "" order by character_id, voice_id'):
        line = clean(val)
        if not line or line in ('Cygames',) or line in seen[cid]:
            continue
        seen[cid].add(line)
        voices[cid].append({'voice_id': vid, 'scene': VOICE_SCENES.get(scene, scene),
                            'text': line})

    # Training events: as the trainee (card) and as a support card.
    def event_titles(column):
        out = defaultdict(list)
        got = defaultdict(set)
        for cid, sid in q(f'select {column}, story_id from single_mode_story_data '
                          f'where {column} > 0 order by story_id'):
            title = text[CAT_EVENT_TITLE].get(sid)
            if title and title not in got[cid]:
                got[cid].add(title)
                out[cid].append(title)
        return out
    trainee_events = event_titles('card_chara_id')
    support_events = event_titles('support_chara_id')

    chara_stories = defaultdict(list)
    for cid, sid in q('select chara_id, story_id from chara_story_data order by story_id'):
        title = text[CAT_CHARA_STORY_TITLE].get(sid)
        if title:
            chara_stories[cid].append(title)

    # Home-screen conversations: who appears together.
    home = defaultdict(Counter)
    for row in q('select chara_id_1, chara_id_2, chara_id_3 from home_story_trigger'):
        cast = [x for x in row if x]
        for a in cast:
            for b in cast:
                if a != b:
                    home[a][b] += 1

    # Number of story events each character headlines.
    story_event_cast = Counter()
    for (cid,) in q('select character_id from (select distinct story_event_id, '
                    'character_id from story_event_top_chara)'):
        story_event_cast[cid] += 1

    # Affinity: sum of relation points over shared relation groups.
    points = dict(q('select relation_type, relation_point from succession_relation'))
    groups = defaultdict(set)
    for rtype, cid in q('select relation_type, chara_id from succession_relation_member'):
        groups[rtype].add(cid)
    affinity = defaultdict(Counter)
    for rtype, members in groups.items():
        for a in members:
            for b in members:
                if a != b:
                    affinity[a][b] += points.get(rtype, 0)

    # Mentions of other characters in voice lines. A full name counts anywhere.
    # A short name (e.g. グラン, カフェ) also occurs inside ordinary words
    # (グランマ, カフェテリア), so it counts only when an honorific or
    # punctuation follows it.
    import re
    after = r'(?=さん|ちゃん|先輩|せんぱい|会長|様|さま|くん|君|たち|[、。！？!?…ー〜～っ」』\s]|$)'
    patterns = {}
    for cid in ids:
        alts = [re.escape(text[6][cid])]
        short = text[376].get(cid)
        if short and short != text[6][cid] and len(short) >= 2:
            alts.append(re.escape(short) + after)
        patterns[cid] = re.compile('|'.join(alts))
    mentions = defaultdict(Counter)
    for cid, lines in voices.items():
        # Drop the speaker's own name, even when split by punctuation
        # (シュヴァル、グラン), so it never counts as naming someone else.
        own = re.compile('[、・\\s…]*'.join(map(re.escape, text[6][cid])))
        texts = [own.sub('', ln['text']) for ln in lines]
        for other, pat in patterns.items():
            if other == cid:
                continue
            hits = sum(1 for t in texts if pat.search(t))
            if hits:
                mentions[cid][other] = hits

    def named(counter, limit=None):
        return [{'id': k, 'name': text[6].get(k), 'count': v}
                for k, v in counter.most_common(limit)]

    os.makedirs(os.path.join(out_dir, 'chara'), exist_ok=True)
    index = []
    for cid in ids:
        row = chara_rows.get(cid)
        rec = {'id': cid}
        for key, cat in PROFILE_CATEGORIES.items():
            rec[key] = text[cat].get(cid)
        rec['trivia_unlabelled'] = [text[c].get(cid) for c in TRIVIA_CATEGORIES
                                    if text[c].get(cid)]
        rec['chara_category'] = row[1] if row else None
        rec['release_unix'] = row[2] if row else None
        rec['image_color'] = row[3] if row else None
        rec['playable'] = cid in cards
        rec['cards'] = cards.get(cid, [])
        rec['support_card_count'] = support_cards.get(cid, 0)
        rec['chara_story_titles'] = chara_stories.get(cid, [])
        rec['trainee_event_titles'] = trainee_events.get(cid, [])
        rec['support_event_titles'] = support_events.get(cid, [])
        rec['home_scene_partners'] = named(home[cid])
        rec['mentions_in_voice'] = named(mentions[cid])
        rec['mentioned_by'] = named(Counter({o: m[cid] for o, m in mentions.items()
                                             if m.get(cid)}))
        rec['top_affinity'] = named(affinity[cid], 12)
        rec['story_event_appearances'] = story_event_cast.get(cid, 0)
        rec['voice_lines'] = voices.get(cid, [])
        with open(os.path.join(out_dir, 'chara', f'{cid}.json'), 'w',
                  encoding='utf-8') as f:
            json.dump(rec, f, ensure_ascii=False, indent=1)
        index.append({k: rec[k] for k in ('id', 'name_jp', 'name_en', 'playable',
                                          'chara_category', 'dorm', 'grade')}
                     | {'voice_count': len(rec['voice_lines']),
                        'event_count': len(rec['trainee_event_titles'])
                        + len(rec['support_event_titles'])})

    edges = []
    for a in ids:
        for b in ids:
            if a < b and (home[a][b] or mentions[a][b] or mentions[b][a]):
                edges.append({'a': a, 'b': b, 'home': home[a][b],
                              'mention_ab': mentions[a][b], 'mention_ba': mentions[b][a],
                              'affinity': affinity[a][b]})
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    with open(os.path.join(out_dir, 'graph.json'), 'w', encoding='utf-8') as f:
        json.dump(edges, f, ensure_ascii=False)
    print(f'{len(ids)} characters, {len(edges)} edges')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
