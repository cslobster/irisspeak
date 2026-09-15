#!/usr/bin/env python3
"""Push the v2 folder taxonomy (vocab/folders_v2.json, from build_folders.py) into the web app's data files:

  web-client/public/folders.json         folder cards: id, path, label, icon, words, triggers + card_folder {card id: path}
  web-client/public/cboard_folders.json  browse tree rows for the folders that have no Cboard page (path = folder label)

Existing Cboard folders and sub-folders keep their browse pages; a v2 folder that maps onto a Cboard path reuses it.
"""
import csv, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, '..', 'web-client', 'public')
rows = list(csv.DictReader(open(os.path.join(ROOT, 'vocab', 'vocab.csv'))))
byid = {r['id']: r for r in rows}
img = json.load(open(os.path.join(PUB, 'card_images.json')))
v2 = json.load(open(os.path.join(ROOT, 'vocab', 'folders_v2.json')))['folders']
old = json.load(open(os.path.join(PUB, 'folders.json')))
old_by_path = {f['path']: f for f in old['folders']}
ICONS = {  # folder card pictures (Mulberry where one fits, else the emoji fallback the app already renders)
    'health': '/symbols/mulberry/medicine.svg', 'hygiene': '/symbols/mulberry/toothbrush.svg', 'toys': '/symbols/mulberry/toys.svg', 'sports': '/symbols/mulberry/football.svg',
    'home': '/symbols/mulberry/house.svg', 'kitchen': '/symbols/mulberry/kitchen.svg', 'transport': '/symbols/mulberry/bus.svg', 'celebrations': '/symbols/mulberry/birthday_cake.svg',
    'music_art': '/symbols/mulberry/music.svg', 'shapes_position': '/symbols/mulberry/shapes.svg', 'quantity': '/symbols/mulberry/more.svg', 'describing': '/symbols/mulberry/big.svg',
    'feelings': '/symbols/mulberry/happy.svg', 'questions': '/symbols/mulberry/question.svg', 'nature_world': '/symbols/mulberry/tree.svg', 'tools_work': '/symbols/mulberry/hammer.svg',
    'shopping_money': '/symbols/mulberry/shop.svg', 'actions_move': '/symbols/mulberry/run.svg', 'actions_do': '/symbols/mulberry/make.svg', 'actions_say': '/symbols/mulberry/talk.svg',
    'actions_care': '/symbols/mulberry/sleep.svg', 'things': '/symbols/mulberry/box.svg', 'ideas': '/symbols/mulberry/idea.svg', 'phr_social': '/symbols/mulberry/hello.svg',
    'phr_ask': '/symbols/mulberry/please.svg', 'phr_no': '/symbols/mulberry/no.svg', 'phr_repair': '/symbols/mulberry/pardon.svg', 'phr_say': '/symbols/mulberry/speech_bubble.svg',
}
def icon_for(f):
    p = ICONS.get(f['id'])
    if p and os.path.exists(os.path.join(PUB, p.lstrip('/'))): return p
    for c in f['members']:   # first member with a picture
        e = img.get(c, {})
        if e.get('img'): return e['img']
    return old_by_path.get(f.get('path') or '', {}).get('icon') or '/symbols/mulberry/folder.svg'

folders_out = []; card_folder = {}
TOP_ON_PARENT = 12          # a split folder's page shows its sub-folders plus this many most frequent words
for f in v2:
    path = f.get('path') or f['label']          # Cboard page if there is one, else a page named after the folder
    base = old_by_path.get(path, {})
    entry = {'id': f['id'], 'path': path, 'label': f['label'], 'icon': icon_for(f) if not base else base['icon'],
             'words': [byid[c]['label'] for c in f['members']], 'triggers': sorted(set(f.get('triggers', []) + base.get('triggers', [])))}
    folders_out.append(entry)
    for c in f['members']: card_folder[c] = path
    for sf in f.get('subfolders', []):   # browse-only pages under the parent (the model row is the parent's)
        folders_out.append({'path': f"{path} > {sf['name']}", 'label': sf['name'], 'icon': next((img[c]['img'] for c in sf['members'] if img.get(c, {}).get('img')), entry['icon']),
                            'words': sf['words'], 'triggers': []})
# Cboard sub-folders whose parent was not split keep their pages
known = {f['path'] for f in folders_out}; split_parents = {(f.get('path') or f['label']) for f in v2 if f.get('subfolders')}
for f in old['folders']:
    if f['path'] not in known and ' > ' in f['path'] and f['path'].split(' > ')[0] not in split_parents: folders_out.append(f)
json.dump({'folders': folders_out, 'category_to_folder': old.get('category_to_folder', {}), 'card_folder': card_folder},
          open(os.path.join(PUB, 'folders.json'), 'w'), ensure_ascii=False)

# browse rows: rebuilt from the taxonomy (Root row for yes/no kept; Cboard pages of unsplit folders kept)
cb_old = json.load(open(os.path.join(PUB, 'cboard_folders.json')))
v2_paths = {(f.get('path') or f['label']) for f in v2}
cb = [r for r in cb_old if r['folder'] == 'Root' or (r['folder'].split(' > ')[0] not in v2_paths and r['folder'] not in v2_paths)]
added = 0
def row(path, c):
    e = img.get(c, {}); return {'folder': path, 'word': byid[c]['label'], 'image_url': e.get('img'), 'emoji': e.get('emoji')}
for f in v2:
    path = f.get('path') or f['label']
    if f.get('subfolders'):
        for c in f['members'][:TOP_ON_PARENT]: cb.append(row(path, c)); added += 1
        for sf in f['subfolders']:
            for c in sf['members']: cb.append(row(f"{path} > {sf['name']}", c)); added += 1
    else:
        for c in f['members']: cb.append(row(path, c)); added += 1
# clock phrases for "What time is it?": a browse-only page under Time (free cards, no model rows)
CLOCK = [f"{h} o'clock" for h in range(1, 13)] + ['half past', 'quarter past', 'quarter to', '5 past', '10 past', '20 past', '25 past', '5 to', '10 to', '20 to', '25 to',
         'in the morning', 'in the afternoon', 'in the evening', 'at night', 'midday', 'midnight', 'now', 'soon', 'later', 'not yet', 'I don\'t know']
time_path = next(((f.get('path') or f['label']) for f in v2 if f['id'] == 'time'), 'time')
clock_path = f'{time_path} > Hours & minutes'
cb = [r for r in cb if r['folder'] != clock_path]
for w in CLOCK: cb.append({'folder': clock_path, 'word': w, 'image_url': None, 'emoji': '🕐'})
json.dump(cb, open(os.path.join(PUB, 'cboard_folders.json'), 'w'), ensure_ascii=False)
fj = json.load(open(os.path.join(PUB, 'folders.json')))
if not any(f['path'] == clock_path for f in fj['folders']):
    fj['folders'].append({'path': clock_path, 'label': 'Hours & minutes', 'icon': '/symbols/mulberry/clock.svg', 'words': CLOCK, 'triggers': []})
    json.dump(fj, open(os.path.join(PUB, 'folders.json'), 'w'), ensure_ascii=False)
print(f'folders.json: {len(folders_out)} folders ({len(v2)} v2 + Cboard sub-folders), card_folder for {len(card_folder)} cards; cboard_folders.json +{added} rows')
