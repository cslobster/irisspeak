"""
Generate MiniLM-L6-v2 embeddings for corpus_vocabulary.csv
Outputs: data/minilm_name_embeddings.bin + data/minilm_name_embeddings.meta.json
"""
import csv
import json
import os
import struct
import sys

def main():
    data_dir = os.path.join(os.path.dirname(__file__), "../data")
    csv_path = os.path.join(data_dir, "corpus_vocabulary.csv")
    bin_path = os.path.join(data_dir, "minilm_name_embeddings.bin")
    meta_path = os.path.join(data_dir, "minilm_name_embeddings.meta.json")

    print("Loading corpus...")
    words = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            words.append(row["name_en"])
    print(f"  {len(words)} words loaded")

    print("Loading MiniLM-L6-v2 model...")
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer("sentence-transformers/paraphrase-MiniLM-L6-v2")

    print("Encoding...")
    embeddings = model.encode(words, batch_size=256, show_progress_bar=True, normalize_embeddings=True)
    dim = embeddings.shape[1]
    print(f"  Embedding dim: {dim}, count: {len(embeddings)}")

    print("Writing .bin...")
    with open(bin_path, "wb") as f:
        for emb in embeddings:
            f.write(struct.pack(f"{dim}f", *emb))

    print("Writing .meta.json...")
    with open(meta_path, "w") as f:
        json.dump({"words": words, "dim": dim, "count": len(words)}, f)

    print(f"Done. {len(words)} embeddings written to {bin_path}")

if __name__ == "__main__":
    main()
