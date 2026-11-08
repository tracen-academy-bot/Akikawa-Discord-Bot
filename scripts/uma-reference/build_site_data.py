"""Merge verified briefs with the raw extraction into the page's data file.

Usage:
    python3 -I build_site_data.py <scratchpad_dir> <source_date>

Reads <scratchpad>/data/chara/*.json, <scratchpad>/briefs/*.json and
<scratchpad>/groups.json; writes <scratchpad>/site/uma-data.json.
A character without a brief still appears, with raw data only.
"""

import glob
import json
import os
import sys

DORMS_EN = {'栗東寮': 'Ritto Dorm', '美浦寮': 'Miho Dorm'}
RAW_PROFILE_KEYS = ['name_jp', 'voice_actor', 'dorm', 'grade', 'birthday', 'height',
                    'tagline', 'self_intro', 'strengths', 'weaknesses', 'about_ears',
                    'about_tail', 'shoe_size', 'about_family', 'trivia_unlabelled']
RAW_KEEP = ['playable', 'cards', 'image_color', 'chara_story_titles',
            'trainee_event_titles', 'support_event_titles', 'home_scene_partners',
            'mentions_in_voice', 'mentioned_by', 'top_affinity', 'voice_lines']


def load(path):
    """Read a JSON file, or None if it is missing or broken."""
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main(sp, source_date):
    """Build the merged data file and report coverage."""
    charas, missing = [], []
    for path in sorted(glob.glob(os.path.join(sp, 'data', 'chara', '*.json')),
                       key=lambda p: int(os.path.basename(p)[:-5])):
        raw = load(path)
        brief = load(os.path.join(sp, 'briefs', os.path.basename(path))) or {}
        if not brief:
            missing.append(raw['id'])
        rec = dict(brief)
        rec['id'] = raw['id']
        rec['name_jp'] = raw['name_jp']
        rec['name_en'] = brief.get('name_en') or raw.get('name_en') or raw['name_jp']
        rec['kind'] = brief.get('kind') or ('uma' if raw['id'] < 2000 else 'npc')
        rec['profile_en_dorm'] = DORMS_EN.get(raw.get('dorm'))
        rec['raw_profile'] = {k: raw.get(k) for k in RAW_PROFILE_KEYS}
        for k in RAW_KEEP:
            rec[k] = raw.get(k)
        rec['voice_count'] = len(raw['voice_lines'])
        rec['event_count'] = (len(raw['trainee_event_titles'])
                              + len(raw['support_event_titles'])
                              + len(raw['chara_story_titles']))
        charas.append(rec)
    out = {
        'meta': {'source_date': source_date, 'missing_briefs': missing},
        'charas': charas,
        'edges': load(os.path.join(sp, 'data', 'graph.json')) or [],
        'groups': load(os.path.join(sp, 'groups.json')) or {},
    }
    os.makedirs(os.path.join(sp, 'site'), exist_ok=True)
    dest = os.path.join(sp, 'site', 'uma-data.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(charas)} characters, {len(missing)} without a brief: {missing}; '
          f'{os.path.getsize(dest) / 1e6:.1f} MB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
