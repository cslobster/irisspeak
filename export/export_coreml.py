"""Export the card model to Core ML (Apple's native runtime: fp16 on the Neural Engine / GPU, weights memory-mapped).
The package takes a right-padded token window (input_ids, attention_mask; both int32 [1, L]) and returns the card
logits at every position ([1, L, n_cards], fp16); the app reads the row of the last real token. Only the card head is
exported (not the 151,936-word LM head), which the on-device card predictor never needs.

Usage: python3 export/export_coreml.py --ckpt train/out/qwen3_06b_v31/card_model.pt --hf export/out_qwen31/hf_extended \\
           --out export/out_qwen31/coreml --seq 256 --parity 48
"""
import os, sys, json, argparse, random, time
import numpy as np, torch
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, os.path.join(ROOT, "train"))
from train_smollm import CardModel, encode_batch, load_vocab, MODEL
from transformers import AutoTokenizer, AutoModelForCausalLM
import coremltools as ct

class CardHead(torch.nn.Module):
    """Backbone hidden states -> card logits, for every position of a fixed right-padded window."""
    def __init__(self, decoder, head):
        super().__init__(); self.decoder = decoder; self.register_buffer("head", head)   # (n_cards, H)
    def forward(self, input_ids, attention_mask):
        # Causal + padding mask as a 4D additive tensor built with plain ops: transformers' own mask builder uses
        # torch.vmap, which torch.jit.trace cannot record; a 4D mask is passed through untouched. -1e4 is fp16-safe.
        L = input_ids.shape[1]
        causal = torch.tril(torch.ones(L, L, dtype=torch.bool))
        allowed = causal[None, None] & (attention_mask[:, None, None, :] > 0)
        mask4 = torch.where(allowed, torch.zeros((), dtype=torch.float32), torch.full((), -1e4, dtype=torch.float32))
        h = self.decoder(input_ids=input_ids, attention_mask=mask4, use_cache=False).last_hidden_state   # (1, L, H)
        return h @ self.head.T                                                                             # (1, L, n)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ckpt", required=True); ap.add_argument("--hf", required=True, help="hf_extended dir from export_onnx_optimum.py")
    ap.add_argument("--out", required=True); ap.add_argument("--seq", type=int, default=256); ap.add_argument("--parity", type=int, default=48)
    ap.add_argument("--name", default="IrisSpeakCard"); ap.add_argument("--target", default="iOS18"); ap.add_argument("--precision", default="fp16", choices=["fp16", "fp32"]); a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    ids, speak = load_vocab(); n = len(ids); id2idx = {c: i for i, c in enumerate(ids)}; start_idx = n
    bj = os.path.join(os.path.dirname(a.ckpt), "backbone.json"); model_name = json.load(open(bj))["model"] if os.path.exists(bj) else MODEL
    tok = AutoTokenizer.from_pretrained(model_name); tok.padding_side = "right"
    if tok.pad_token_id is None: tok.pad_token = tok.eos_token

    ext = AutoModelForCausalLM.from_pretrained(a.hf, dtype=torch.float32, attn_implementation="eager"); ext.eval()
    V = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32).get_input_embeddings().weight.size(0)
    head = ext.get_output_embeddings().weight[V:V + n].detach().clone()      # card + folder + <name> + <aac_end> rows
    wrap = CardHead(ext.model, head).eval()
    L = a.seq
    ex = tok("Setting: home.\nPartner: hi")["input_ids"]
    ex_ids = torch.zeros(1, L, dtype=torch.int32); ex_ids[0, :len(ex)] = torch.tensor(ex, dtype=torch.int32)
    ex_mask = torch.zeros(1, L, dtype=torch.int32); ex_mask[0, :len(ex)] = 1
    print("tracing", model_name, "L =", L, flush=True); t0 = time.time()
    with torch.no_grad(): traced = torch.jit.trace(wrap, (ex_ids, ex_mask), check_trace=False)
    print(f"traced in {time.time()-t0:.0f}s; converting…", flush=True); t0 = time.time()
    ml = ct.convert(traced, convert_to="mlprogram", compute_precision=ct.precision.FLOAT16 if a.precision == "fp16" else ct.precision.FLOAT32, minimum_deployment_target=getattr(ct.target, a.target),
                    inputs=[ct.TensorType(name="input_ids", shape=(1, L), dtype=np.int32), ct.TensorType(name="attention_mask", shape=(1, L), dtype=np.int32)],
                    outputs=[ct.TensorType(name="card_logits", dtype=np.float16 if a.precision == "fp16" else np.float32)], compute_units=ct.ComputeUnit.ALL)
    ml.short_description = f"IrisSpeak card model ({model_name} backbone, {n} card rows, window {L})"
    ml.user_defined_metadata["seq"] = str(L); ml.user_defined_metadata["n_cards"] = str(n); ml.user_defined_metadata["backbone"] = model_name
    path = os.path.join(a.out, a.name + ".mlpackage"); ml.save(path)
    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)
    print(f"converted in {time.time()-t0:.0f}s: {path} ({size/1e6:.0f} MB)", flush=True)

    # ---- parity vs the trained torch model on held-out states (same encoding as the app: text ids + card tokens)
    base = AutoModelForCausalLM.from_pretrained(model_name, dtype=torch.float32)
    model = CardModel(base, n, torch.zeros(n + 1, base.get_input_embeddings().weight.size(1))); model.load_state_dict(torch.load(a.ckpt, map_location="cpu"), strict=False); model.eval(); model.out_mask.fill_(True)
    test = [json.loads(l) for l in open(os.path.join(ROOT, "data", "states", "test_qa.jsonl"))]; random.seed(3); random.shuffle(test); par = test[: a.parity]
    ov = t1 = N = 0; lat = []
    with torch.no_grad():
        for s in par:
            t_ids, t_mask, c_idx, c_mask = encode_batch(tok, [s], id2idx, start_idx, "cpu")
            ref = model(t_ids, t_mask, c_idx, c_mask)[0][0].numpy()
            seq = torch.cat([t_ids[:, : int(t_mask.sum())], (c_idx + V)[:, : int(c_mask.sum())]], 1)[0].numpy()
            if len(seq) > L: seq = seq[-L:]
            ii = np.zeros((1, L), dtype=np.int32); mm = np.zeros((1, L), dtype=np.int32); ii[0, : len(seq)] = seq; mm[0, : len(seq)] = 1
            t0 = time.time(); out = ml.predict({"input_ids": ii, "attention_mask": mm})["card_logits"]; lat.append(time.time() - t0)
            got = np.asarray(out)[0, len(seq) - 1].astype(np.float32)
            ov += len(set(np.argsort(-ref)[:100]) & set(np.argsort(-got)[:100])) / 100; t1 += int(np.argmax(ref) == np.argmax(got)); N += 1
    print(f"coreml parity vs torch on {N} states: top-100 overlap {ov/N:.3f}, top-1 agreement {t1/N:.3f}, Mac latency {np.median(lat)*1000:.0f} ms (median, after warm-up)", flush=True)

if __name__ == "__main__":
    main()
