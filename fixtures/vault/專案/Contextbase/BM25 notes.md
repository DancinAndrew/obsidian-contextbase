# BM25 notes

BM25 scores a document by summing, over the query terms, the IDF of each term times a saturated term frequency.
The parameter k1 controls how fast term frequency saturates, and b controls length normalization.
SQLite FTS5 uses k1 = 1.2 and b = 0.75 and returns negative scores, so a smaller score is better.
