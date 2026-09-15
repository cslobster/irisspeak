#!/usr/bin/env python3
"""Replay the app's pipeline (ONNX fp16 card model -> reranker -> panel split) for one partner question and
show where given cards land. Usage: python3 eval/inspect_question.py "Read, or draw?" --setting school --watch read draw
"""
import argparse, json, math, sys, numpy as np, onnxruntime as ort
from transformers import AutoTokenizer
ROOT = __import__('os').path.dirname(__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
M = ROOT + '/site/public/model/'
ap = argparse.ArgumentParser(); ap.add_argument('question'); ap.add_argument('--setting', default='home'); ap.add_argument('--watch', nargs='*', default=[]); ap.add_argument('--prefix', nargs='*', default=[]); ap.add_argument('--top', type=int, default=30)
a = ap.parse_args()
meta = json.load(open(M + 'cards.json')); cards = meta['cards']; V = meta.get('V', 49152); start = meta['start_index']; nOut = meta['n_outputs']
byLabel = {c['speak'].lower(): i for i, c in enumerate(cards)}
tok = AutoTokenizer.from_pretrained('HuggingFaceTB/SmolLM2-135M-Instruct')
prompt = f"Setting: {a.setting}.\nPartner: {a.question[:200]}\nReply cards:"
ids = tok(prompt, add_special_tokens=True)['input_ids'] + [V + start] + [V + byLabel[p.lower()] for p in a.prefix]
sess = ort.InferenceSession(__import__('os').environ.get('BOARD_ONNX', ROOT + '/export/out_v31/card_model_fp16.onnx'), providers=['CPUExecutionProvider'])
L = len(ids); feed = {'input_ids': np.array([ids], dtype=np.int64), 'attention_mask': np.ones((1, L), dtype=np.int64)}
if 'position_ids' in [i.name for i in sess.get_inputs()]: feed['position_ids'] = np.arange(L, dtype=np.int64)[None]
logits = sess.run(None, feed)[0][0, -1, V:V + nOut].astype(np.float32)
for j in meta.get('dead', []): logits[j] = -1e4   # dead-row mask, as in the app
p = np.exp(logits - logits.max()); p /= p.sum(); order = np.argsort(-p)
# reranker
rr = json.load(open(M + 'reranker.json')); freq = json.load(open(M + 'freq.json'))
cv = np.fromfile(M + 'card_vecs.bin', dtype=np.float16).astype(np.float32).reshape(-1, 384)
from sentence_transformers import SentenceTransformer
q = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu').encode([a.question], normalize_embeddings=True)[0]
uni = np.array(freq['uni']); last = byLabel[a.prefix[-1].lower()] if a.prefix else -1
bi = dict((int(k), v) for k, v in freq['bi'].get(str(last), [])) if isinstance(freq['bi'].get(str(last), []), list) else {}
biSum = sum(bi.values()) + freq['smoothing'] * len(uni)
def fl(j): return math.log(freq['lambda_bi'] * (bi.get(j, freq['smoothing']) / biSum) + (1 - freq['lambda_bi']) * (uni[j] / uni.sum()))
scores = []
for r, j in enumerate(order[:rr['K']]):
    c = cards[j]; x = []
    raw = [math.log(p[j] + 1e-12), math.log(r + 1), fl(j), float(cv[j] @ q)]
    x += [(raw[k] - rr['mu'][k]) / rr['sd'][k] for k in range(4)]
    x += [1.0 if c['category'] == cat else 0.0 for cat in rr['cats']]
    x += [1.0 if c['intent'] == it else 0.0 for it in rr['ints']]
    x += [c.get('core', 0) or 0, c.get('safety', 0) or 0, c.get('composable', 0) or 0, c.get('multiword', 0) or 0, 1.0 if c['id'] == '<aac_end>' else 0.0, 1.0 if c['id'] == '<name>' else 0.0, min(len(a.prefix), 6) / 6, 1.0]
    if rr['dim'] > len(x): x.append(1.0 if c.get('is_folder') else 0.0)
    h = np.array(x, dtype=np.float32)
    for li, Lr in enumerate(rr['layers']):
        h = np.array(Lr['W']) @ h + np.array(Lr['b']); h = np.maximum(h, 0) if li < len(rr['layers']) - 1 else h
    scores.append((float(h[0]), int(j), raw))
scores.sort(key=lambda s: -s[0]); ranked = [j for _, j, _ in scores]
ACT = {'actions', 'activities', 'play'}
def cat(c): return 'feeling' if c['category'] == 'feelings' else 'action' if c['category'] in ACT else 'topic'
print(f'question: {a.question!r}  setting: {a.setting}  prefix: {a.prefix}')
print('\nmodel order (top %d):' % a.top)
for r, j in enumerate(order[:a.top]): print(f"  {r+1:3d} {p[j]:.4f} {cards[j]['speak']:<16} {cards[j]['category']}")
print('\nreranked (top %d):' % a.top)
for r, (s, j, raw) in enumerate(scores[:a.top]): print(f"  {r+1:3d} score {s:+.2f} p {p[j]:.4f} sim {raw[3]:+.2f} freq {raw[2]:+.1f} {cards[j]['speak']:<16} {cards[j]['category']}")
print('\npanels shown (Topic 9 / Action 6 / Feeling 3):')
pan = {'topic': [], 'action': [], 'feeling': []}
for j in ranked:
    c = cards[j]
    if c.get('is_folder'): continue
    if c['id'] in ('<aac_end>', '<name>') or c['category'] == 'core' or c['speak'].lower() in ("yes", "no", "i don't know", "i want"): continue
    k = cat(c); lim = {'topic': 9, 'action': 6, 'feeling': 3}[k]
    if len(pan[k]) < lim: pan[k].append(c['speak'])
for k, v in pan.items(): print(f'  {k}: {v}')
fr = [(cards[j]['speak'], round(float(p[j]), 3), ranked.index(j) + 1 if j in ranked else None) for j in range(len(cards)) if cards[j].get('is_folder')]
fr.sort(key=lambda t: -t[1]); print('  folder rows (p, reranked position):', [t for t in fr if t[1] > 0.01 or (t[2] or 99) <= 16][:4])
for w in a.watch:
    j = byLabel.get(w.lower())
    if j is None: print(f'\n{w}: not a card'); continue
    mr = int(np.where(order == j)[0][0]) + 1; rrk = ranked.index(j) + 1 if j in ranked else None
    print(f"\n{w}: model rank {mr} (p={p[j]:.4f}), reranked {rrk if rrk else 'outside top-100'}, category {cards[j]['category']}, sim {float(cv[j] @ q):+.2f}, freq {fl(j):+.1f}")
