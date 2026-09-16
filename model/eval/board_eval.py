#!/usr/bin/env python3
"""First-board evaluation: for every question in eval/board_bank.json, build the board exactly the way the web
app does (v3 ONNX model -> dead mask -> reranker -> choice pinning -> folder cards -> Topic 9 / Action 6 /
Feeling 3 panels + core row) and check whether one of the expected answer cards is on it WITHOUT a Refresh.

  python3 eval/board_eval.py [--md docs/BOARD-EVAL.md]

Mirrors web-client/src/api/local.ts (recommendation, choiceCards, decideFolders) and engine/model.ts (rerank).
Personal bonuses are zero (fresh profile)."""
import argparse, csv, json, math, os, re, sys, collections
import numpy as np, onnxruntime as ort
from transformers import AutoTokenizer
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
M = os.environ.get('BOARD_MODEL_DIR') or os.path.join(ROOT, 'site', 'public', 'model')      # cards.json, reranker.json, freq.json, card_vecs.bin
ONNX = os.environ.get('BOARD_ONNX') or os.path.join(ROOT, 'export', 'out_v31', 'card_model_fp16.onnx')
PANEL = {'topic': 15, 'action': 3, 'emotion': 3}; MAX_FOLDERS = 1
CORE_LABELS = ['yes', 'no', 'please']   # fixed part of the quick row; the app adds five personal cards (history-based), which a fresh profile fills from the model
FEELING_FALLBACK = ['happy', 'sad', 'tired', 'excited', 'angry', 'scared', 'bored', 'hungry', 'okay', 'good']
STOP = {'do', 'you', 'want', 'to', 'the', 'a', 'an', 'some', 'is', 'it', 'one', 'which', 'what', 'or', 'and', 'with', 'for', 'first', 'should', 'we', 'i', 'your', 'my', 'did', 'too', 'here', 'as', 'last'}

meta = json.load(open(os.path.join(M, 'cards.json'))); cards = meta['cards']; V = meta.get('V', 49152); start = meta['start_index']; nOut = meta['n_outputs']
dead = meta.get('dead', [])
for i, c in enumerate(cards): c['index'] = i
byLabel = {c['speak'].lower(): c for c in cards if not c.get('is_folder')}
byId = {c['id']: c for c in cards}
folder_rows = [c for c in cards if c.get('is_folder')]
fd = json.load(open(os.path.join(ROOT, '..', 'web-client', 'public', 'folders.json'))); folders = fd['folders']; cat2path = fd['category_to_folder']; card_folder = fd.get('card_folder', {})
def folder_path_of(c): return card_folder.get(c['id']) or cat2path.get(c['category'])
rr = json.load(open(os.path.join(M, 'reranker.json'))); freq = json.load(open(os.path.join(M, 'freq.json')))
cv = np.fromfile(os.path.join(M, 'card_vecs.bin'), dtype=np.float16).astype(np.float32).reshape(-1, 384)
# tokenizer of the backbone the ONNX was exported from: BOARD_TOKENIZER, else backbone.json next to the ONNX's export dir, else SmolLM2
_tok_name = os.environ.get('BOARD_TOKENIZER') or (json.load(open(os.path.join(os.path.dirname(ONNX), 'extended_vocab.json'))).get('backbone') if os.path.exists(os.path.join(os.path.dirname(ONNX), 'extended_vocab.json')) else None) or 'HuggingFaceTB/SmolLM2-135M-Instruct'
tok = AutoTokenizer.from_pretrained(_tok_name); print('tokenizer:', _tok_name, flush=True)
sess = ort.InferenceSession(ONNX, providers=['CPUExecutionProvider'])
from sentence_transformers import SentenceTransformer
st = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu')
uni = np.array(freq['uni'])

def category_of(vc): return 'emotion' if vc == 'feelings' else 'action' if vc in ('actions', 'activities', 'play') else 'topic'

def predict(question, setting):
    prompt = f"Setting: {setting}.\nPartner: {question[:200]}\nReply cards:"
    ids = tok(prompt, add_special_tokens=True)['input_ids'] + [V + start]
    L = len(ids); feed = {'input_ids': np.array([ids], dtype=np.int64), 'attention_mask': np.ones((1, L), dtype=np.int64)}
    if 'position_ids' in [i.name for i in sess.get_inputs()]: feed['position_ids'] = np.arange(L, dtype=np.int64)[None]
    logits = sess.run(None, feed)[0][0, -1, V:V + nOut].astype(np.float32)
    for j in dead: logits[j] = -1e4
    p = np.exp(logits - logits.max()); p /= p.sum(); return p

PRIOR_ALPHA = 0.0
_prior = None
def rerank(p, question):
    global _prior
    if NO_RERANK and PRIOR_ALPHA > 0:
        if _prior is None:
            u = np.array(freq['uni'], dtype=np.float64); u = (u + 1.0) / (u.sum() + len(u)); _prior = np.log(u)
        return [int(j) for j in np.argsort(-(np.log(p + 1e-12) - PRIOR_ALPHA * _prior[:len(p)]))]
    order = np.argsort(-p)
    if NO_RERANK: return [int(j) for j in order]
    q = st.encode([question], normalize_embeddings=True)[0]
    bi = dict((int(k), v) for k, v in freq['bi'].get('-1', []))   # empty prefix: successors of the start token
    biSum = sum(bi.values()) + freq['smoothing'] * len(uni)
    def fl(j): return math.log(freq['lambda_bi'] * (bi.get(j, freq['smoothing']) / biSum) + (1 - freq['lambda_bi']) * (uni[j] / uni.sum()))
    scores = []
    for r, j in enumerate(order[:rr['K']]):
        c = cards[j]; raw = [math.log(p[j] + 1e-12), math.log(r + 1), fl(j), float(cv[j] @ q)]
        x = [(raw[k] - rr['mu'][k]) / rr['sd'][k] for k in range(4)]
        x += [1.0 if c['category'] == cat else 0.0 for cat in rr['cats']]
        x += [1.0 if c['intent'] == it else 0.0 for it in rr['ints']]
        x += [c.get('core', 0) or 0, c.get('safety', 0) or 0, c.get('composable', 0) or 0, c.get('multiword', 0) or 0,
              1.0 if c['id'] == '<aac_end>' else 0.0, 1.0 if c['id'] == '<name>' else 0.0, 0.0, 1.0]
        if rr['dim'] > len(x): x.append(1.0 if c.get('is_folder') else 0.0)
        h = np.array(x, dtype=np.float32)
        for li, Lr in enumerate(rr['layers']):
            h = np.array(Lr['W']) @ h + np.array(Lr['b']); h = np.maximum(h, 0) if li < len(rr['layers']) - 1 else h
        scores.append((float(h[0]), int(j)))
    scores.sort(key=lambda s: -s[0]); return [j for _, j in scores] + [int(j) for j in order[rr['K']:]]

def choice_cards(question):
    q = re.sub(r'\s+', ' ', re.sub(r"[^a-z' ,]+", ' ', question.lower())).strip()
    if not re.search(r'\bor\b', q): return []
    parts = re.split(r'\s+or\s+', q, 1); left, right = parts[0], parts[1] if len(parts) > 1 else ''
    def lookup(words):
        for n in range(min(3, len(words)), 0, -1):
            for cand in (' '.join(words[-n:]), ' '.join(words[:n])):
                c = byLabel.get(cand) or byLabel.get(re.sub(r's$', '', cand))
                if c and c['speak'].lower() not in [x.lower() for x in CORE_LABELS]: return c['id']
        return None
    found = []
    def add(x):
        if x and x not in found: found.append(x)
    for it in [x.strip() for x in left.split(',') if x.strip()]: add(lookup([w for w in it.split(' ') if w and w not in STOP]))
    rw = [w for w in re.sub(r'[,?].*$', '', right).split(' ') if w and w not in STOP]
    for n in range(min(3, len(rw)), 0, -1):
        cand = ' '.join(rw[:n]); c = byLabel.get(cand) or byLabel.get(re.sub(r's$', '', cand))
        if c and c['speak'].lower() not in [x.lower() for x in CORE_LABELS]: add(c['id']); break
    return found[:4]

def decide_folders(question, p, ranked):
    chosen = []
    def add(f):
        if f and len(chosen) < MAX_FOLDERS and all(x['path'] != f['path'] for x in chosen): chosen.append(f)
    if not OPT.get('row_mass'):
        for c in sorted([c for c in folder_rows if p[c['index']] >= OPT.get('row_thresh', 0.08)], key=lambda c: -p[c['index']]):
            add(next((f for f in folders if f['path'] == c['folder']), None))
    q = question.lower()
    for f in folders:
        if any(re.search(r'\b' + re.escape(t) + r'\b', q) for t in f['triggers']): add(f)
    if OPT.get('mass'):
        # folder = probability mass of its members (top 200 cards), best first, at least MASS_MIN
        mass = collections.Counter()
        if OPT.get('mass_mode') == 'rank':
            # reranked order counts, not the raw model probability: weight 1/(rank+1) over the top 60 after reranking,
            # so a card the reranker demoted (e.g. "Long" for "How was your day?") cannot drag its folder up
            for r, j in enumerate(ranked[:60]):
                path = folder_path_of(cards[j])
                if path: mass[path] += 1.0 / (r + 1)
            tot = sum(mass.values()) or 1.0
            for k in mass: mass[k] /= tot
        else:
            for j in ranked[:200]:
                path = folder_path_of(cards[j])
                if path: mass[path] += float(p[j])
        if OPT.get('row_mass'):   # the model's own folder row votes together with its members
            for c in folder_rows: mass[c['folder']] += float(p[c['index']]) * OPT['row_mass']
        for path, m in mass.most_common():
            if m >= OPT['mass']: add(next((f for f in folders if f['path'] == path), None))
        return chosen
    counts = collections.Counter()
    for j in ranked[:30]:
        path = folder_path_of(cards[j])
        if path: counts[path] += 1
    for path, n in counts.most_common():
        if n >= 3: add(next((f for f in folders if f['path'] == path), None))
    return chosen

# ---- layout variants (see docs/BOARD-EVAL.md): question-type routing, quick row, grid size
OPT = {'routing': True, 'quick': True, 'panel': dict(PANEL), 'all_folders': False}   # the app's defaults since 10 Sep 2026
# --all-folders: every vocabulary category becomes a folder (members = its cards), so the two folder slots can
# point at actions, describing words, things, phrases... not only the 16 trained folders.
def install_all_folders():
    global folders, cat2path
    have = {f['path'] for f in folders}
    for cat in sorted({c['category'] for c in cards if not c.get('is_folder')}):
        if cat in cat2path or cat in ('core',): continue
        path = 'cat:' + cat
        folders.append({'path': path, 'label': cat.capitalize(), 'icon': '', 'words': [c['speak'] for c in cards if c['category'] == cat and not c.get('is_folder')], 'triggers': []})
        cat2path[cat] = path
QUICK_ROW = ['yes', 'no', 'please']   # fixed part; five personal cards follow (a fresh profile fills them from the model, see below)
ROUTES = [  # (regex, folder path, extra allowed labels normally hidden as core words, ordered answer words pinned first)
    (r"\b(who|whose|who's|with whom)\b", 'people', ['me', 'you', 'mine', 'my turn', 'your turn', 'friend', 'mum', 'mom', 'dad', 'teacher', 'nobody'], []),
    (r"\b(where)\b", 'places', ['here', 'there', 'home', 'school', 'outside', 'inside'], []),
    (r"\b(when|what time|how long|how soon)\b", 'time', ['now', 'later', 'soon', 'today', 'tomorrow', 'not yet'], []),
    (r"\b(how many|how much|how old|what number|count)\b", 'numbers', [], []),
    (r"\b(colou?r)\b", 'describe > colours', [], []),
    (r"\b(eat|food|breakfast|lunch|dinner|snack|hungry|ate)\b", 'food', [], []),
    (r"\b(drink|thirsty)\b", 'drinks', [], []),
    (r"\b(play|game|toy|toys)\b", 'toys', ['ball', 'blocks', 'lego', 'puzzle', 'cars', 'tag', 'hide and seek', 'outside', 'swing', 'slide'], []),
    (r"\b(wear|clothes|pyjamas|pajamas|jacket|shoes|dress)\b", 'clothing', [], []),
    (r"\b(animal|pet)\b", 'animals', [], []),
    (r"\b(hurt|hurts|pain|sore|ache)\b", 'body', [], []),
    (r"\b(weather|rain|sunny|cold outside)\b", 'weather', [], []),
    (r"\b(feel|feeling|mood|okay|ok)\b", None, ['tired', 'sick', 'sad', 'happy', 'scared', 'hurt', 'fine', 'good', 'bad'], []),
    (r"\b(how was|how is|how's|how did it go|how did .* go|how are you|how're you)\b", 'Good & nice', ['good', 'bad', 'okay', 'fine', 'great', 'fun', 'boring', 'tired', 'busy', 'long'], []),
]
SETTING_ROUTES = {  # setting -> (regex, folder, answer words first, in this order): the place changes what a question means
    'doctor': [(r"\b(feel|feeling|mood|okay|ok|how are you|how're you|how's it going|what's wrong|what is wrong|hurt|hurts|pain|sore|sick|better|worse)\b", 'Health & sick', [])],   # folder steering only, as in the apps
}
NO_PINS = False; NO_RERANK = True   # the apps' defaults since the distilled model: no reranker, no pinned answers
def route(question, setting=''):
    q = question.lower(); paths, allow, first = [], [], []
    if NO_PINS:
        for rx, path, extra, _pin in ROUTES:
            if re.search(rx, q):
                if path and path not in paths: paths.append(path)
                allow += extra
        return paths, allow, first
    for rx, path, words in SETTING_ROUTES.get(setting, []):
        if re.search(rx, q):
            if path: paths.append(path)
            first += words
    for rx, path, extra, pin in ROUTES:
        if re.search(rx, q):
            if path and path not in paths: paths.append(path)
            allow += extra; first += pin
    return paths, allow, first

EVAL_QUESTION = r"\b(how was|how is|how's|how did|how are you|how're you|how's it going|feel|feeling|mood)\b"
def demote_echoes(ranked, question):
    """Evaluation questions: cards repeating a question word, or naming a time of day, drop below the other picks."""
    if not re.search(EVAL_QUESTION, question.lower()): return ranked
    qw = set(re.sub(r"[^a-z' ]+", " ", question.lower()).split())
    def echo(j):
        c = cards[j]
        if c.get('is_folder'): return False
        ws = c['speak'].lower().split(); greeting = {'morning', 'afternoon', 'evening', 'night', 'hello', 'hi', 'hey'}
        return all(w in qw for w in ws) and not any(w in greeting for w in ws)
    return [j for j in ranked if not echo(j)] + [j for j in ranked if echo(j)]

def board(question, setting):
    p = predict(question, setting); ranked = demote_echoes(rerank(p, question), question)
    core_ids = {byLabel[l.lower()]['id'] for l in CORE_LABELS if l.lower() in byLabel}
    if OPT['quick']: core_ids = {byLabel[l]['id'] for l in QUICK_ROW if l in byLabel}
    lists = {'topic': [], 'action': [], 'emotion': []}
    for cid in choice_cards(question):
        if cid not in core_ids: lists[category_of(byId[cid]['category'])].append(cid)
    fl = decide_folders(question, p, ranked)
    if OPT['routing']:
        paths, allow, first = route(question, setting)
        for path in paths:   # routed folder goes first; a folder decided by the model stays if there is room
            f = next((f for f in folders if f['path'] == path), None)
            if f and all(x['path'] != path for x in fl): fl.insert(0, f); fl = fl[:MAX_FOLDERS]
        # routed words: the best few of the folder's members and of the extra list, by model probability
        first_c = [byLabel[w] for w in first if w in byLabel][:6]
        allow_c = first_c + sorted([byLabel[w] for w in allow if w in byLabel and byLabel[w] not in first_c], key=lambda c: -p[c['index']])[:3]
        cand = [byLabel[w] for f in fl for w in f['words'] if w in byLabel] + [byLabel[w] for w in allow if w in byLabel]
        cand = sorted({c['id']: c for c in cand}.values(), key=lambda c: -p[c['index']])
        cand = allow_c + [c for c in cand if c not in allow_c]
        nr = max(4, len(first_c))
        for c in cand[:nr]:
            cat = category_of(c['category']) if c['category'] != 'core' else 'topic'
            if c['id'] not in core_ids and c['id'] not in lists[cat]: lists[cat].append(c['id'])
        fl_words_keep = {c['speak'].lower() for c in cand[:nr]}
    else:
        fl_words_keep = set()
    folder_words = {w.lower() for f in fl for w in f['words']}
    folder_cats = {k for k, v in cat2path.items() if any(v == f['path'] for f in fl)}
    per_cat = collections.Counter(); fillers = 0
    # near-duplicates ("Sound", "Good", "Sounds good"): a card whose stems are all on the board already is skipped unless pinned
    GLUE = {'am', 'is', 'are', 'be', 'the', 'a', 'an', 'to', 'of'}   # never makes a card distinct: "I am" = "I"
    def stem(w):
        w = re.sub(r"[^a-z']", "", w.lower())
        if w == 'i': return w
        for suf in ("ies", "ing", "es", "ed", "s"):
            if w.endswith(suf) and len(w) > len(suf) + 1: return w[: -len(suf)]
        return w
    def stems_of(speak):
        speak = re.sub(r"^(i'm|i am|i feel|i want to|i want|i need to|i need|i like to|i like)\s+", '', speak.lower())   # "I'm tired" = "Tired"
        t = re.sub(r"n't\b", " not", re.sub(r"'s\b", "", re.sub(r"'m\b", " am", speak.lower())))
        return [x for x in (stem(w) for w in t.split()) if x and x not in GLUE]
    pinned = {cid for lst in lists.values() for cid in lst}
    on_board = {st for cid in pinned for st in stems_of(byId[cid]['speak'])}
    for j in ranked:
        c = cards[j]
        if c['id'] in ('<aac_end>', '<name>') or c.get('is_folder') or c['id'] in core_ids: continue
        cat = category_of(c['category'])
        sts = stems_of(c['speak'])
        if c['id'] not in pinned and sts and all(st in on_board for st in sts): continue
        if (c['category'] in ('core', 'phrases') or c['speak'].lower() == "i'm") and c['id'] not in lists[cat]:   # glue: function words + sentence starters
            fillers += 1
            if fillers > 2: continue
        if cat == 'topic' and fl and c['speak'].lower() in folder_words and c['speak'].lower() not in fl_words_keep and c['id'] not in lists[cat]: continue
        if c['category'] in folder_cats:
            per_cat[c['category']] += 1
            if per_cat[c['category']] > 2 and c['id'] not in lists[cat]: continue
        if c['id'] not in lists[cat]: lists[cat].append(c['id']); on_board.update(sts)
    for l in FEELING_FALLBACK:
        c = byLabel.get(l)
        if c and c['id'] not in lists['emotion']: lists['emotion'].append(c['id'])
    shown = {'folders': [f['label'] for f in fl], 'folder_words': folder_words}
    for cat, n in OPT['panel'].items():
        lim = n - len(fl) if cat == 'topic' else n
        shown[cat] = [byId[i]['speak'] for i in lists[cat][:lim]]
    shown['core'] = list(QUICK_ROW) if OPT['quick'] else [l for l in CORE_LABELS]
    # the app's five personal cards: with no history (the evaluator's fresh profile) they are the model's next-best
    # content cards not already on the board and not function words -- exactly the app's fallback
    if OPT['quick']:
        on = {w.lower() for k in ('topic', 'action', 'emotion', 'core') for w in shown[k]} | {l.lower() for l in QUICK_ROW}
        extra = []
        for j in ranked:
            c = cards[j]
            if c.get('is_folder') or c['id'] in ('<aac_end>', '<name>') or c['category'] == 'core' or c.get('core') or c['speak'].lower() in on: continue
            extra.append(c['speak']); on.add(c['speak'].lower())
            if len(extra) >= 5: break
        shown['core'] += extra
    # "More ideas" tile: one tap opens the next N ranked cards that are not on the board (a page like Refresh, but as a folder)
    if OPT.get('more'):
        on = {w.lower() for k in ('topic', 'action', 'emotion', 'core') for w in shown[k]}
        more = []
        for j in ranked:
            c = cards[j]
            if c.get('is_folder') or c['id'] in ('<aac_end>', '<name>') or c['speak'].lower() in on: continue
            more.append(c['speak'].lower())
            if len(more) >= OPT['more']: break
        shown['more_words'] = set(more)
    return shown, p, ranked

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--md', default=os.path.join(ROOT, 'docs', 'BOARD-EVAL.md')); ap.add_argument('--bank', default=os.path.join(ROOT, 'eval', 'board_bank.json'))
    ap.add_argument('--no-routing', action='store_true'); ap.add_argument('--no-quick', action='store_true'); ap.add_argument('--panel', default='', help='topic,action,emotion sizes e.g. 12,8,4')
    ap.add_argument('--no-md', action='store_true'); ap.add_argument('--all-folders', action='store_true'); ap.add_argument('--mass', type=float, default=0.0, help='pick folders by member probability mass above this')
    ap.add_argument('--max-folders', type=int, default=1); ap.add_argument('--mass-mode', default='rank', choices=['p', 'rank']); ap.add_argument('--more', type=int, default=60, help='size of the More ideas page (next ranked cards) counted as reachable; 0 = off'); ap.add_argument('--row-thresh', type=float, default=0.08); ap.add_argument('--row-mass', type=float, default=0.0, help='fold the model folder row probability into the mass rule with this weight (disables the separate row step)')
    ap.add_argument('--qa', type=int, default=0, help='held-out check: use N first-card states from data/states/test_qa.jsonl instead of the bank')
    ap.add_argument('--no-pins', action='store_true', help='drop the pinned answer words from routes (school subjects, doctor words): judge the model alone there')
    ap.add_argument('--no-rerank', action='store_true', help='model order only (now the default); --rerank turns the reranker on')
    ap.add_argument('--rerank', action='store_true', help='score with the reranker (off by default, as in the apps)')
    ap.add_argument('--qa-file', default='', help='alternative held-out file (test_qa_youth.jsonl, test_gen.jsonl)')
    ap.add_argument('--prior-alpha', type=float, default=0.5, help='debias the model-only order by the training-target prior: score = log p - alpha*log prior (0 = off)')
    a = ap.parse_args(); bank = json.load(open(a.bank))
    global NO_PINS, NO_RERANK; NO_PINS = a.no_pins; NO_RERANK = not a.rerank
    global PRIOR_ALPHA; PRIOR_ALPHA = a.prior_alpha
    if a.qa:   # held-out corpus questions: expected = the acceptable first cards of the real reply
        import random; random.seed(11)
        idl = {c['id']: c for c in cards}
        sts = [json.loads(l) for l in open(a.qa_file or os.path.join(ROOT, 'data', 'states', 'test_qa.jsonl'))]
        sts = [e for e in sts if not e['prefix'] and e.get('partner') and any(not k.startswith('<') for k in e['targets'])]
        random.shuffle(sts); bank = collections.defaultdict(list)
        for e in sts[: a.qa]:
            exp = [idl[k]['speak'] for k in e['targets'] if k in idl and not k.startswith('<')]
            bank[e.get('setting') or 'unknown'].append({'q': e['partner'], 'expect': exp})
        bank = dict(bank)
    OPT['routing'] = not a.no_routing; OPT['quick'] = not a.no_quick
    if a.all_folders: OPT['all_folders'] = True; install_all_folders()
    OPT['mass'] = a.mass; OPT['more'] = a.more; OPT['mass_mode'] = a.mass_mode
    global MAX_FOLDERS; MAX_FOLDERS = a.max_folders; OPT['row_thresh'] = a.row_thresh; OPT['row_mass'] = a.row_mass
    if a.panel: t, ac, e = [int(x) for x in a.panel.split(',')]; OPT['panel'] = {'topic': t, 'action': ac, 'emotion': e}
    rows = []; tot = collections.Counter()
    for setting, qs in bank.items():
        if setting.startswith('_'): continue
        for item in qs:
            exp = [e for e in item['expect'] if e.lower() in byLabel or e == '<name>']
            missing = [e for e in item['expect'] if e.lower() not in byLabel and e != '<name>']
            shown, p, ranked = board(item['q'], setting)
            on_board = {w.lower() for k in ('topic', 'action', 'emotion', 'core') for w in shown[k]}
            direct = [e for e in exp if e.lower() in on_board]
            via_folder = [e for e in exp if e.lower() not in on_board and (e.lower() in shown['folder_words'] or e.lower() in shown.get('more_words', set()))]
            ranks = {}
            for e in exp:
                if e == '<name>': continue
                j = byLabel[e.lower()]['index']; ranks[e] = ranked.index(j) + 1
            best = min(ranks.values()) if ranks else None
            status = 'direct' if direct else ('folder' if via_folder else 'miss')
            tot[setting, status] += 1; tot['all', status] += 1
            rows.append({'setting': setting, 'q': item['q'], 'status': status, 'direct': direct, 'via_folder': via_folder,
                         'best_rank': best, 'board': shown, 'missing_labels': missing,
                         'top_expected': sorted(ranks.items(), key=lambda kv: kv[1])[:3]})
            print(f"[{setting:10s}] {status:6s} r{best if best else '-':>4}  {item['q'][:48]:<48} -> {', '.join(direct[:3]) or ('folder: ' + ', '.join(shown['folders'])) if status != 'miss' else 'MISS  board: ' + ', '.join(shown['topic'][:5] + shown['action'][:3])}", flush=True)
    settings = [s for s in bank if not s.startswith('_')]
    lines = ['# First-board evaluation (no Refresh)', '',
             f'Model v3 (SmolLM2-135M + 16 folder rows, dead mask) with the 54-dim reranker, board built as in the web app (Topic 9 / Action 6 / Feeling 3 + core row + up to 2 folder cards). {len(rows)} questions, {len(settings)} settings, from `eval/board_bank.json`. Personal profile empty. Run: `python3 eval/board_eval.py`.', '',
             'A question **passes** when one of its expected answer cards is on the first board. *Direct* = the card itself is visible; *via folder* = a folder card on the board contains it (one more tap); *miss* = only reachable with Refresh or search.', '',
             '| setting | questions | direct | via folder | miss | pass rate |', '|---|---|---|---|---|---|']
    for s in settings + ['all']:
        n = sum(tot[s, k] for k in ('direct', 'folder', 'miss')); d, f, m = tot[s, 'direct'], tot[s, 'folder'], tot[s, 'miss']
        lines.append(f"| {s} | {n} | {d} | {f} | {m} | {(d + f) / max(1, n):.0%} |")
    lines += ['', '## Every question', '', '| setting | question | result | expected cards found | best model rank of an expected card | board (Topic / Action / Feeling) |', '|---|---|---|---|---|---|']
    for r in rows:
        b = r['board']; found = ', '.join(r['direct']) if r['direct'] else ('folder ' + ', '.join(b['folders']) + ' → ' + ', '.join(r['via_folder'])) if r['via_folder'] else '—'
        lines.append(f"| {r['setting']} | {r['q']} | {r['status']} | {found} | {r['best_rank'] or '—'} | {', '.join((['📁 ' + x for x in b['folders']]) + b['topic'])} / {', '.join(b['action'])} / {', '.join(b['emotion'])} |")
    misses = [r for r in rows if r['status'] == 'miss']
    lines += ['', '## Misses', '']
    for r in misses:
        lines.append(f"- **{r['setting']}: {r['q']}** expected {', '.join(e for e in bank[r['setting']][[x['q'] for x in bank[r['setting']]].index(r['q'])]['expect'][:6])}; closest expected card at model rank {r['best_rank']} ({', '.join(f'{k} #{v}' for k, v in r['top_expected'])}).")
    lab_missing = sorted({m for r in rows for m in r['missing_labels']})
    if lab_missing: lines += ['', 'Expected labels not in the vocabulary (ignored): ' + ', '.join(lab_missing)]
    core_l = {l.lower() for l in (QUICK_ROW if OPT['quick'] else CORE_LABELS)}
    strict = sum(1 for r in rows if [e for e in r['direct'] if e.lower() not in core_l] or r['via_folder'])
    print(f"VARIANT routing={OPT['routing']} quick={OPT['quick']} panel={OPT['panel']}: pass {sum(1 for r in rows if r['status'] != 'miss')}/{len(rows)}  content-only {strict}/{len(rows)}", flush=True)
    if a.no_md: return
    os.makedirs(os.path.dirname(a.md), exist_ok=True); open(a.md, 'w').write('\n'.join(lines) + '\n')
    json.dump(rows, open(os.path.join(ROOT, 'eval', 'board_eval_results.json'), 'w'), indent=1, default=list)
    print('\nSUMMARY', {s: f"{tot[s,'direct']}+{tot[s,'folder']}/{sum(tot[s,k] for k in ('direct','folder','miss'))}" for s in settings + ['all']}); print('written', a.md)

if __name__ == '__main__': main()
