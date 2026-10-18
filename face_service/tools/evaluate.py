import itertools
import numpy as np

# embeddings: dict person_id -> list of L2-normalised np.ndarray (one per session)


def score_pairs(embeddings):
    genuine, impostor = [], []
    people = list(embeddings)
    for p in people:
        for a, b in itertools.combinations(embeddings[p], 2):
            genuine.append(float(a @ b))
    for p, q in itertools.combinations(people, 2):
        for a in embeddings[p]:
            for b in embeddings[q]:
                impostor.append(float(a @ b))
    return np.array(genuine), np.array(impostor)


def report(genuine, impostor):
    for t in np.arange(0.30, 0.80, 0.05):
        far = (impostor >= t).mean()   # different people that would be flagged as duplicates
        frr = (genuine < t).mean()     # same person that would NOT be caught
        print(f"t={t:.2f}  false-duplicate={far:.5f}  missed-duplicate={frr:.4f}")
