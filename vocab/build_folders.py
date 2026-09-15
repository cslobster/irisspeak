#!/usr/bin/env python3
"""Assign every vocabulary card to one folder (v2 folder taxonomy, ~40 folders of 15-90 cards).

Sources, in order of trust:
  1. Mulberry's own 117-category taxonomy for the 1,264 cards that map to a Mulberry symbol (symbol-info.csv)
  2. the Cboard folder word lists the app already ships (web-client/public/folders.json)
  3. the vocabulary category where it is unambiguous (feelings, questions, numbers, ...)
  4. nearest folder centroid in MiniLM space (card_vecs.bin) for the rest, with k-means sub-clusters for the
     big residual groups (actions, things, describing) so no folder exceeds ~90 cards
Phrases are split by intent (greetings, asking, refusing, repair, statements).

Writes vocab/card_folders.json {card_id: folder_id}, vocab/folders_v2.json (folder list with members, label,
Cboard path, triggers) and vocab/FOLDERS-V2.md (review table).
"""
import csv, json, os, io, zipfile, collections, re, sys
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MULB = '/private/tmp/claude-504/-Users-haobo-work4-aac/c8345de9-9956-48a6-ab2c-9e37a5914f0d/scratchpad/mulberry/mulberry.zip'

rows = list(csv.DictReader(open(os.path.join(ROOT, 'vocab', 'vocab.csv'))))
byid = {r['id']: r for r in rows}; bylabel = {r['label'].lower(): r['id'] for r in rows}
meta = json.load(open(os.path.join(ROOT, 'site', 'public', 'model', 'cards.json')))
idx = {c['id']: i for i, c in enumerate(meta['cards'])}
vecs = np.fromfile(os.path.join(ROOT, 'site', 'public', 'model', 'card_vecs.bin'), dtype=np.float16).astype(np.float32).reshape(-1, 384)

# ---- folder definitions: id -> (label, Cboard browse path or None, triggers)
FOLDERS = {
    'numbers': ('Numbers', 'numbers', ['how old', 'your age', 'what age', 'how many', 'how much', 'what number', 'count']),
    'time': ('Time', 'time', ['what time', 'when', 'how long', 'what day', 'which day']),
    'food': ('Food', 'food', ['eat', 'food', 'breakfast', 'lunch', 'dinner', 'hungry', 'snack']),
    'drinks': ('Drinks', 'drinks', ['drink', 'thirsty']),
    'people': ('People', 'people', ['who', 'whose', 'with whom']),
    'family': ('Family', 'people > family', ['family', 'mum', 'dad', 'grandma', 'grandpa', 'brother', 'sister']),
    'places': ('Places', 'places', ['where', 'which place', 'go to']),
    'school': ('School', 'school', ['school', 'class', 'lesson', 'homework', 'teacher']),
    'technology': ('Technology', 'technology', ['phone', 'computer', 'tablet', 'ipad', 'tv', 'game', 'video']),
    'body': ('Body', 'body', ['hurt', 'hurts', 'pain', 'sore', 'ache', 'where does it', 'body']),
    'animals': ('Animals', 'animals', ['animal', 'animals', 'pet', 'zoo', 'farm']),
    'weather': ('Weather', 'weather', ['weather', 'rain', 'sunny', 'snow', 'cold outside', 'hot outside']),
    'clothing': ('Clothing', 'clothing', ['wear', 'clothes', 'dress', 'jacket', 'shoes', 'pyjamas', 'pajamas', 'put on']),
    'colours': ('Colours', 'describe > colours', ['colour', 'color', 'colours', 'colors']),
    'plants': ('Plants & garden', 'plants', ['plant', 'flower', 'tree', 'garden']),
    'health': ('Health & sick', None, ['sick', 'ill', 'doctor', 'medicine', 'hospital', 'feel well', 'unwell']),
    'hygiene': ('Bathroom & hygiene', 'hygiene', ['bath', 'shower', 'brush', 'wash', 'teeth', 'toilet', 'potty']),
    'toys': ('Toys & games', 'toys', ['play', 'game', 'toy', 'toys']),
    'sports': ('Sports', 'sports', ['sport', 'sports', 'ball', 'match', 'team']),
    'home': ('Home & furniture', 'furniture', ['room', 'bed', 'sofa', 'furniture', 'house']),
    'kitchen': ('Kitchen', 'kitchen', ['cook', 'kitchen', 'bake', 'plate', 'cup']),
    'transport': ('Transport', 'transport', ['bus', 'car', 'train', 'drive', 'how will we get', 'ride']),
    'celebrations': ('Celebrations', None, ['birthday', 'party', 'christmas', 'halloween', 'holiday', 'present']),
    'music_art': ('Music & art', None, ['music', 'song', 'sing', 'draw', 'paint', 'instrument']),
    'shapes_position': ('Shapes & where', 'describe > shapes', ['shape', 'which way', 'left or right', 'on top', 'under']),
    'quantity': ('How much', None, ['more or less', 'big or small', 'how big', 'enough']),
    'describing': ('Describing', None, ['what is it like', 'how does it look', 'how was it', 'describe']),
    'feelings': ('Feelings', None, ['feel', 'feeling', 'mood', 'happy', 'sad', 'okay', 'how are you']),
    'questions': ('Questions', None, ['ask', 'question']),
    'nature_world': ('Nature & world', None, ['space', 'moon', 'star', 'planet', 'sea', 'beach', 'mountain']),
    'tools_work': ('Tools & work', None, ['fix', 'build', 'tool', 'work']),
    'shopping_money': ('Shopping & money', None, ['buy', 'shop', 'money', 'cost', 'pay']),
    'actions_move': ('Moving & going', None, ['move', 'walk', 'run', 'jump', 'come', 'go']),
    'actions_do': ('Doing & making', None, ['do', 'make', 'help me', 'what are you doing']),
    'actions_say': ('Talking & thinking', None, ['say', 'tell', 'think', 'know', 'remember']),
    'actions_care': ('Everyday routines', None, ['sleep', 'wake', 'rest', 'tired', 'bedtime']),
    'things': ('Things', None, ['what is that', 'what do you need', 'which thing']),
    'ideas': ('Ideas & topics', None, ['what about', 'topic', 'idea', 'talk about']),
    'phr_social': ('Hello & thanks', None, ['hello', 'hi', 'bye', 'thank']),
    'phr_ask': ('Asking for things', None, ['what do you need', 'want anything', 'can i get you']),
    'phr_no': ('No & stop', None, ['do you want', 'shall we', 'is it okay']),
    'phr_repair': ('Say it again', None, ['what did you say', 'pardon', 'understand', 'did you mean']),
    'phr_say': ('Ready phrases', None, []),
    'little_words': ('Little words', None, ['which one', 'who did', 'what did', 'whose']),   # pronouns, auxiliaries, prepositions: the glue words
}
# Mulberry category -> folder
MULB2F = {
    'Number': 'numbers', 'Number Activity': 'school', 'Descriptive Time': 'time',
    'Food Vegetables and salads': 'food', 'Food Vegetables and salad': 'food', 'Food Fruit': 'food', 'Food Breads and baking': 'food', 'Food Meals and snacks': 'food',
    'Food Sweets and desserts': 'food', 'Food Meat': 'food', 'Food Dairy': 'food', 'Food Ingredients': 'food', 'Food Nuts': 'food', 'Food Pastas and rice': 'food',
    'Food Poultry': 'food', 'Food Eggs': 'food', 'Food Fish and seafood': 'food', 'Food Diet': 'food', 'Food Feeding and eating': 'food',
    'Drink Type': 'drinks', 'Drink Containers and measures': 'drinks', 'Drink Actions': 'drinks', 'Drink Description': 'drinks',
    'People Profession': 'people', 'People Relationship': 'family', 'People Feelings': 'feelings', 'People Descriptive': 'describing', 'People Actions': 'actions_move',
    'Building Public': 'places', 'Building Residential': 'places', 'Building School': 'places', 'Building Shop': 'shopping_money', 'Building Office and factory': 'places', 'Holiday and travel': 'nature_world',
    'Work and School Stationery': 'school', 'Work and School Timetable': 'school', 'Work and School Subjects': 'school', 'Work and School Education': 'school',
    'Electrical General': 'technology', 'Electrical Media': 'technology', 'Electrical Computer': 'technology', 'Electrical Phone': 'technology', 'Computer Icon': 'technology', 'Communication Aid': 'technology',
    'Healthcare Body parts': 'body', 'Animal Features': 'animals', 'Healthcare Medical conditions': 'health', 'Healthcare Medical items': 'health',
    'Healthcare Grooming items': 'hygiene', 'Healthcare Grooming activities': 'hygiene', 'Communication Signs': 'hygiene',
    'Animal Mammal': 'animals', 'Animal Birds': 'animals', 'Animal Spiders and Insects': 'animals', 'Animal Reptiles and Amphibians': 'animals', 'Animal Fish and Marine mammals': 'animals',
    'Animal Habitat': 'animals', 'Animal Crustacean and Molluscs': 'animals', 'Animal Other Invertebrates': 'animals', 'Animal Activity Feeding': 'animals',
    'Environment Weather': 'weather', 'Clothes General': 'clothing', 'Clothes Sport': 'clothing', 'Clothes Accessories': 'clothing', 'Clothes Jewellery': 'clothing',
    'Art Colour': 'colours', 'Plants and Trees': 'plants', 'Building Garden and farm': 'plants', 'Tools Garden': 'plants',
    'Leisure Toys': 'toys', 'Leisure Games': 'toys', 'Leisure Playground': 'toys', 'Sport': 'sports', 'Sport Accessories': 'sports',
    'Building Furniture': 'home', 'Building Contents': 'home', 'Building Structure': 'home', 'Building Equipment and devices': 'home', 'Building Household tasks': 'home',
    'Food Kitchen items': 'kitchen', 'Food Kitchen actions': 'kitchen',
    'Transport Road': 'transport', 'Transport Air': 'transport', 'Transport Water': 'transport', 'Transport Rail': 'transport', 'Transport Space': 'nature_world',
    'Celebration Item': 'celebrations', 'Celebration Event': 'celebrations', 'Religion Festival': 'celebrations', 'Religion General': 'celebrations', 'Religion Person': 'celebrations',
    'Music Instrument': 'music_art', 'Art Making': 'music_art',
    'Descriptive Shape': 'shapes_position', 'Descriptive Position': 'shapes_position', 'Descriptive Direction': 'shapes_position',
    'Descriptive Quantity': 'quantity', 'Descriptive State': 'describing', 'Question': 'questions',
    'Science Astronomy': 'nature_world', 'Science': 'nature_world', 'Tools Workshop': 'tools_work', 'Tools Actions': 'tools_work', 'Military': 'things',
    'Money': 'shopping_money', 'Communication Conversation': 'phr_social', 'Alphabet': None, 'Verb': None,   # verbs: clustered below
}
CAT2F = {'feelings': 'feelings', 'questions': 'questions', 'numbers': 'numbers', 'time': 'time', 'food': 'food', 'drink': 'drinks', 'animals': 'animals',
         'colours': 'colours', 'clothes': 'clothing', 'transport': 'transport', 'body': 'body', 'weather': 'weather', 'places': 'places', 'technology': 'technology',
         'school': 'school', 'people': 'people', 'play': 'toys', 'home': 'home', 'nature': 'plants', 'health': 'health', 'music': 'music_art', 'quantity': 'quantity', 'ideas': 'ideas'}
INTENT2F = {'social': 'phr_social', 'request': 'phr_ask', 'refuse': 'phr_no', 'repair': 'phr_repair', 'question': 'questions', 'statement': 'phr_say', 'affirm': 'phr_say', 'feeling': 'feelings'}

# hand names for the k-means sub-folders (seed 1; re-check after any change to the member set)
SPLIT_NAMES = {'describing_1': 'Good & nice', 'describing_2': 'Ways & opinions', 'describing_3': 'How things are',
               'actions_do_1': 'Get & carry', 'actions_do_2': 'Want & do', 'things_1': 'Things 1', 'things_2': 'Things 2', 'things_3': 'Things 3',
               'actions_say_1': 'Talking', 'actions_say_2': 'Thinking & senses', 'actions_move_1': 'Going places', 'actions_move_2': 'Moving the body'}

def main():
    assign = {}; source = {}
    # 1. Mulberry
    z = zipfile.ZipFile(MULB); raw = z.read([n for n in z.namelist() if n.endswith('symbol-info.csv')][0]).decode('utf-8', 'ignore')
    byfile = {r['symbol-en'].lower(): r['category-en'] for r in csv.DictReader(io.StringIO(raw))}
    for m in csv.DictReader(open(os.path.join(ROOT, 'vocab', 'mulberry_map.csv'))):
        cat = byfile.get(os.path.basename(m['mulberry_file'])[:-4].lower()); f = MULB2F.get(cat)
        if f and m['card_id'] not in assign: assign[m['card_id']] = f; source[m['card_id']] = 'mulberry'
    # 2. Cboard word lists (parent folder of the path -> folder id via browse path)
    fd = json.load(open(os.path.join(ROOT, 'web-client', 'public', 'folders.json')))
    path2f = {v[1]: k for k, v in FOLDERS.items() if v[1]}
    sub2f = {'people > characters': 'people', 'places > countries': 'places', 'animals > birds': 'animals', 'animals > insects': 'animals', 'animals > marine animals': 'animals',
             'animals > wild animals': 'animals', 'food > fruit': 'food', 'food > vegetables': 'food', 'food > soup': 'food', 'clothing > clothing accessories': 'clothing',
             'school > class room': 'school', 'snacks': 'food', 'activities': None}
    for f in fd['folders']:
        fid = path2f.get(f['path']) or sub2f.get(f['path'])
        if not fid: continue
        for w in f['words']:
            cid = bylabel.get(w.lower())
            if cid and cid not in assign: assign[cid] = fid; source[cid] = 'cboard'
    # 3. Claude's labels for everything Mulberry and Cboard did not cover (vocab/claude_folder_labels.json,
    #    produced by the labelling agents from the residue dumped below), then the vocabulary category for
    #    anything still open
    residue = [{'id': r['id'], 'word': r['label'], 'speak': r['speak'], 'category': r['category'], 'intent': r['intent'], 'freq': r['corpus_freq']} for r in rows if r['id'] not in assign and r['category'] != 'core']
    json.dump(residue, open(os.path.join(ROOT, 'vocab', 'folder_residue.json'), 'w'), indent=0)
    lab_path = os.path.join(ROOT, 'vocab', 'claude_folder_labels.json')
    if os.path.exists(lab_path):
        labels = json.load(open(lab_path)); n_ok = 0
        for cid, f in labels.items():
            if cid in byid and cid not in assign and f in FOLDERS: assign[cid] = f; source[cid] = 'claude'; n_ok += 1
        print('claude labels applied:', n_ok, 'of', len(labels))
    for r in rows:
        if r['id'] in assign: continue
        if r['category'] == 'phrases' and r['intent'] in INTENT2F: assign[r['id']] = INTENT2F[r['intent']]; source[r['id']] = 'intent'
        elif r['category'] in CAT2F: assign[r['id']] = CAT2F[r['category']]; source[r['id']] = 'category'
    # 4. the rest by nearest centroid, with the verbs / actions / things / describing residue clustered
    def centroid(fid):
        m = [idx[c] for c, f in assign.items() if f == fid and c in idx]
        return vecs[m].mean(0) if m else None
    cents = {f: centroid(f) for f in FOLDERS}; cents = {f: c / (np.linalg.norm(c) + 1e-9) for f, c in cents.items() if c is not None}
    rest = [r for r in rows if r['id'] not in assign and r['category'] != 'core' and r['id'] in idx]
    # seeds for the action clusters (hand picked), then nearest-seed assignment for actions/activities residue
    SEEDS = {'actions_move': ['go', 'walk', 'run', 'jump', 'come', 'climb', 'swim', 'ride', 'fly', 'move', 'stop', 'sit', 'stand', 'dance', 'fall', 'hide', 'throw', 'catch', 'kick', 'push', 'pull'],
             'actions_do': ['make', 'do', 'build', 'cut', 'open', 'close', 'put', 'take', 'give', 'get', 'hold', 'carry', 'clean', 'fix', 'draw', 'write', 'read', 'play', 'use', 'try', 'finish'],
             'actions_say': ['say', 'tell', 'talk', 'ask', 'answer', 'think', 'know', 'remember', 'forget', 'listen', 'hear', 'see', 'look', 'watch', 'read', 'learn', 'understand', 'mean', 'call'],
             'actions_care': ['sleep', 'wake up', 'rest', 'eat', 'drink', 'wash', 'brush', 'dress', 'nap', 'cuddle', 'hug', 'kiss', 'wait', 'sit down', 'lie down', 'relax', 'calm', 'breathe']}
    seedv = {}
    for f, ws in SEEDS.items():
        m = [idx[bylabel[w]] for w in ws if w in bylabel and bylabel[w] in idx]
        v = vecs[m].mean(0); seedv[f] = v / (np.linalg.norm(v) + 1e-9)
    for r in rest:
        v = vecs[idx[r['id']]]; v = v / (np.linalg.norm(v) + 1e-9)
        if r['category'] in ('actions', 'activities'):
            best = max(seedv, key=lambda f: float(v @ seedv[f])); assign[r['id']] = best; source[r['id']] = 'verb-cluster'; continue
        sims = {f: float(v @ c) for f, c in cents.items() if f not in SEEDS}
        f, s = max(sims.items(), key=lambda kv: kv[1])
        if s >= 0.35: assign[r['id']] = f; source[r['id']] = 'nearest'
        else: assign[r['id']] = {'things': 'things', 'describing': 'describing', 'ideas': 'ideas', 'phrases': 'phr_say'}.get(r['category'], 'things'); source[r['id']] = 'fallback'
    # core function words (pronouns, auxiliaries, prepositions) get their own page so they are one tap away too
    for r in rows:
        if r['id'] not in assign and r['category'] == 'core' and r['id'] in idx: assign[r['id']] = 'little_words'; source[r['id']] = 'core'
    sizes = collections.Counter(assign.values())
    # split any folder over 90 into halves by k-means (2 or 3 clusters), named after their most frequent members
    from sklearn.cluster import KMeans
    for fid, n in list(sizes.items()):
        if n <= 130 or fid not in ('things', 'describing', 'actions_do', 'actions_move', 'actions_say', 'ideas'): continue
        members = [c for c, f in assign.items() if f == fid and c in idx]; k = 2 if n <= 220 else 3
        km = KMeans(n_clusters=k, n_init=5, random_state=1).fit(vecs[[idx[c] for c in members]])
        for j in range(k):
            sub = [c for c, l in zip(members, km.labels_) if l == j]
            top = sorted(sub, key=lambda c: -float(byid[c]['corpus_freq'] or 0))[:3]
            name = ' / '.join(byid[c]['label'] for c in top); sid = f'{fid}_{j+1}'
            FOLDERS[sid] = (SPLIT_NAMES.get(sid, f"{FOLDERS[fid][0]}: {name}"), FOLDERS[fid][1], FOLDERS[fid][2] if j == 0 else [])
            for c in sub: assign[c] = sid
        del FOLDERS[fid]
    sizes = collections.Counter(assign.values())
    # ---- sub-folders: no page may hold more than MAX_PAGE cards. Bigger folders are cut into k-means clusters
    # (named by hand or by the naming agent in vocab/subfolder_names.json); the parent keeps every member for the
    # model row and the triggers, the browse page shows the sub-folders plus the most frequent words.
    MAX_PAGE = 60; TARGET = 38
    names_path = os.path.join(ROOT, 'vocab', 'subfolder_names.json')
    sub_names = json.load(open(names_path)) if os.path.exists(names_path) else {}
    from sklearn.cluster import KMeans
    clusters = {}
    for fid, n in sizes.items():
        if n <= MAX_PAGE: continue
        members = [c for c, f in assign.items() if f == fid and c in idx]; k = max(2, -(-n // TARGET))
        km = KMeans(n_clusters=k, n_init=8, random_state=1).fit(vecs[[idx[c] for c in members]])
        subs = []
        for j in range(k):
            sub = sorted([c for c, l in zip(members, km.labels_) if l == j], key=lambda c: -float(byid[c]['corpus_freq'] or 0))
            if sub: subs.append({'key': f'{fid}_s{j+1}', 'members': sub, 'words': [byid[c]['label'] for c in sub]})
        clusters[fid] = subs
    json.dump({fid: [{'key': s['key'], 'words': s['words']} for s in subs] for fid, subs in clusters.items()},
              open(os.path.join(ROOT, 'vocab', 'subclusters.json'), 'w'), indent=0)
    folders = []
    for fid, (label, path, trig) in FOLDERS.items():
        mem = sorted([c for c, f in assign.items() if f == fid], key=lambda c: -float(byid[c]['corpus_freq'] or 0))
        if not mem: continue
        entry = {'id': fid, 'label': label, 'path': path, 'triggers': trig, 'members': mem, 'words': [byid[c]['label'] for c in mem]}
        if fid in clusters:
            entry['subfolders'] = [{'name': sub_names.get(s['key'], ' / '.join(s['words'][:2])), 'key': s['key'], 'members': s['members'], 'words': s['words']} for s in clusters[fid]]
        folders.append(entry)
    json.dump(assign, open(os.path.join(ROOT, 'vocab', 'card_folders.json'), 'w'), indent=0)
    json.dump({'folders': folders}, open(os.path.join(ROOT, 'vocab', 'folders_v2.json'), 'w'), indent=1)
    unassigned = [r['label'] for r in rows if r['id'] not in assign]
    lines = ['# Folder taxonomy v2 (every card in one folder)', '', f'{len(folders)} folders; {len(assign)} of {len(rows)} cards assigned; unassigned (core function words): {len(unassigned)}', '',
             'Sources: ' + ', '.join(f'{k} {v}' for k, v in collections.Counter(source.values()).most_common()), '', '| folder | cards | first members (by corpus frequency) |', '|---|---|---|']
    for f in sorted(folders, key=lambda f: -len(f['members'])):
        lines.append(f"| {f['label']} (`{f['id']}`) | {len(f['members'])} | {', '.join(f['words'][:18])} |")
        for sf in f.get('subfolders', []): lines.append(f"| ↳ {sf['name']} | {len(sf['members'])} | {', '.join(sf['words'][:14])} |")
    lines += ['', 'Unassigned: ' + ', '.join(unassigned[:80])]
    open(os.path.join(ROOT, 'vocab', 'FOLDERS-V2.md'), 'w').write('\n'.join(lines) + '\n')
    print(f'{len(folders)} folders, {len(assign)} cards assigned, {len(unassigned)} unassigned; sizes:', sorted(sizes.values(), reverse=True))

if __name__ == '__main__': main()
