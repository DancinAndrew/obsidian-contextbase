# Design notes

Contextbase keeps agent memories as Markdown notes and finds them with BM25.
Hooks inject a digest at session start and remind the agent to save at the end of a turn.
The index lives in .contextbase inside the vault and is rebuilt when it is missing.
