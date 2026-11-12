# Tokenizer comparison

Chinese text has no spaces, so the index must split it before BM25 can count terms.
Option one is a word segmenter such as Intl.Segmenter. Option two is overlapping character bigrams.
Bigrams need no dictionary and never miss a new word, but they also create noisy pairs across word boundaries.
