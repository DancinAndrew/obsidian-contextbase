# 相關專案與可以學的地方

> 2026-11-09 整理，11/11 補上「記憶系統的研究」一節。對應 [plan.md](plan.md) v1。星數是 11/09 GitHub 上的數字。標「依描述」的只讀過 repo 簡介，還沒細讀。

## 最接近的四個

### 1. Notion MCP：產品形態的參考

- **架構：** 共用的 workspace、由 Notion 伺服器維護的搜尋索引、Notion 自己架的 MCP server（`https://mcp.notion.com/mcp`，Streamable HTTP，舊客戶端可改用 `/sse`）。用 OAuth 登入，使用者不用安裝任何東西。
- **學：** server 本身不記得任何東西，共用資料、自動索引、讀寫工具三者加起來就是記憶。工具分成搜尋（給摘錄）與讀取（給全文），是漸進揭露。由官方託管，使用者零安裝。
- **差異：** 資料在 Notion 的雲端；Contextbase 在本機，資料是使用者自己的 Markdown。
- **來源：** [Notion：Build an MCP client](https://developers.notion.com/guides/mcp/build-mcp-client.md)、[Stacklok ToolHive 的 Notion 設定指南](https://docs.stacklok.com/toolhive/guides-mcp/notion-remote)、[PulseMCP 的 Notion 條目](https://pulsemcp.com/servers/notion)、[Developers Digest](https://www.developersdigest.tech/mcp-servers/notion)、[mcpservers.org](https://mcpservers.org/remote-mcp-servers/notion)

### 2. thedotmack/claude-mem：最強的現成方案

<https://github.com/thedotmack/claude-mem>｜TypeScript｜115k★

- **學：** 旁邊另跑一個 agent，邊看邊做筆記；新 session 開頭注入短索引，需要時再取細節（索引、時間線、細節三層漸進揭露）。用 hooks 接上各家 agent，README 列出 Claude Code、Codex、Cursor、OpenCode 等 15 種。
- **差異：** 記憶存在 `~/.claude-mem` 的資料庫，不在使用者的筆記裡；每個 session 多跑一個模型；匿名使用統計預設開啟。由模型自動摘要整個 session，模型的推論容易混成事實。
- **對本專案的意義：** 「自動、跨 agent」本身已經不是新點子。Contextbase 的差異要講清楚：記憶是 vault 裡互相連結的筆記，能和使用者自己的筆記一起被搜尋，而且不另跑模型。

### 3. basicmachines-co/basic-memory：Markdown 當記憶

<https://github.com/basicmachines-co/basic-memory>｜Python｜4.5k★｜AGPL-3.0

- **學：** Markdown 檔是權威，SQLite 只是索引；entity、observation、relation 的筆記格式；每個工具標註唯讀、破壞性、可重複執行等行為提示。README 有 Codex 的設定範例，現在也支援全文加向量的混合排序。
- **差異：** 寫入主要靠 agent 呼叫工具，沒有用 hooks 自動讀寫；知識要寫成它的格式。授權是 AGPL，本專案是 MIT，所以只參考設計，不複製程式碼。

### 4. tobi/qmd：本機 Markdown 搜尋

<https://github.com/tobi/qmd>｜TypeScript｜31k★

- **學：** BM25（SQLite FTS5）加向量檢索，再用本機 LLM 重排序；CLI 與 MCP server 共用一套 core；索引放在 `~/.cache/qmd/index.sqlite`，不在筆記資料夾裡。
- **差異：** 純搜尋引擎，沒有記憶的寫入路徑。

## 記憶系統的研究：可以借用的設計

11/11 補充。Notion MCP 只回答「產品長什麼樣子」；記憶本身怎麼寫、怎麼讀、怎麼保持正確，參考下面這些研究與產品。

### Anthropic〈The components of agent memory〉（2026-11-06）

<https://www.anthropic.com/research/components-of-agent-memory>｜Lance Martin

- **內容：** 把記憶由下而上分成對話紀錄、記憶筆記、整理成 wiki 的形式、每次注入的上下文四層，再用離線的 dreaming 在層之間搬運：拿對話紀錄核對筆記、修正、合併重複、修連結，把穩定的事實提到注入層。
- **數據：** 都是 Anthropic 自己的評估，部分只跑一次，沒有報告變異。
  - 約 35 萬個檔案的語料上，只用 wiki 48%、只用搜尋 53%、兩者並用 61%，每題少用約兩萬 token。dreaming 從 2 個 session 增加到 128 個，只用 wiki 的分數從 13% 升到 48%。
  - 需要綜合多份文件的題目，wiki 比搜尋好（87% 對 73%）；只查一份文件的題目沒有明顯幫助。
  - Sonnet 4.6 常常不去讀自己的記憶資料夾，Sonnet 5 十次有九次會讀。
  - 給「只記失敗」這種固定規則，Opus 5 從記憶得到的好處少了 0.234。
  - Pokémon 實驗裡，Sonnet 3.7 寫了 225 個資料夾、413 個檔案，拿到 1 個徽章；Fable 5 寫了 9 個檔案，拿到 4 個。兩者模型能力不同。
- **建議：** 告訴模型記憶的用途，讓它自己判斷什麼值得記；環境看得到的不必存；注入層要小；不要讓多個 agent 同時寫同一頁；標明事實是否經過驗證、為什麼成立；對話紀錄是最終依據。
- **對本專案：** Contextbase 是記憶筆記層、注入層加上搜尋；LLM Wiki 是 wiki 層加上手動的 dreaming，兩者分工（plan.md 3.8）。主動注入與第一句話注入（D7）回應「模型不一定會去讀記憶」；講用途的 server instructions（D10）回應「固定規則有害」；一則一篇（D3）回應「不要同時寫同一頁」。

### Generative Agents（Park et al., 2023）

<https://arxiv.org/abs/2304.03442>

- **學：** 取用記憶時把相關度、新近度（隨時間指數衰減）、重要性（模型打 1 到 10 分）加總；重要性累積到門檻就做 reflection，把記憶整理成更高層的推論。
- **對本專案：** 排名加上新近度與類型（D8），用類型與 `decided_by` 代替模型打分，不必另跑模型。reflection 等於 dreaming，留給使用者要求時做。

### Mem0（2025）與 OpenMemory MCP

<https://arxiv.org/abs/2504.19413>｜<https://mem0.ai/openmemory-mcp>

- **學：** 新記憶寫入前先找相近的舊記憶，由 LLM 決定新增（ADD）、更新（UPDATE）、刪除（DELETE）或不動（NOOP）。
- **對本專案：** `save` 寫入前比對（D9），判斷交給正在工作的 agent。
- **OpenMemory MCP（2025-05）：** Mem0 的本機記憶 server，讓 Cursor、Claude 等 MCP 客戶端共用記憶；自架要用 Docker 跑向量資料庫與 Postgres，記憶存在它的資料庫裡。這是直接的競品，Contextbase 的差別是記憶就是 vault 裡的筆記，不需要另外的服務。

### Zep 與 Graphiti：有時間的知識圖

<https://arxiv.org/abs/2501.13956>｜<https://github.com/getzep/graphiti>

- **學：** 每個事實記下何時開始成立、何時不再成立；新事實和舊的矛盾時，把舊的標成失效而不是刪掉，所以查得到「某一天當時的狀況」。
- **對本專案：** `supersedes` 是同一個想法的簡化版。之後若需要表達「決定其實早幾天就做了」，再加一個生效日期欄位。

### A-MEM（Xu et al., 2025）

<https://arxiv.org/abs/2502.12110>

- **學：** 借用 Zettelkasten 卡片盒筆記法：每則記憶是一張卡片，附關鍵字、標籤與脈絡描述，並自動連到相關的舊卡片；新卡片進來時也會更新舊卡片的描述。
- **對本專案：** 記憶用 `about` 連到筆記，本身就是卡片盒，Obsidian 的使用者熟悉這種結構。「更新舊卡片」違反只新增的原則，不做。

### Letta（前身 MemGPT）

<https://www.letta.com/blog/benchmarking-ai-agent-memory>｜<https://www.letta.com/blog/sleep-time-compute>

- **學：** 一小塊永遠在上下文裡的核心記憶，加上需要時才搜的封存記憶。2025-08 的測試只給 agent 檔案工具（開檔、grep、語意搜尋），在 LoCoMo 拿到 74.0%，高於 Mem0 當時公布的 68.5%。這是 Letta 自己測的，Mem0 後來公布了更高的分數，LoCoMo 本身的效度也有人質疑。2025-04 提出 sleep-time compute：閒置時由背景 agent 整理記憶，是 dreaming 的前身。
- **對本專案：** 簡單的檔案加搜尋已經是很強的基準，MVP 不需要向量資料庫或知識圖。

### LangGraph 與 LangMem：寫入的時機

<https://docs.langchain.com/oss/python/concepts/memory>｜<https://blog.langchain.com/memory-for-agents>

- **學：** 記憶可以在主流程裡寫（hot path：agent 自己呼叫工具存，即時但會拖慢回應），也可以在背景寫（從對話自動萃取，不拖慢回應，但不是馬上可用）。
- **對本專案：** `save` 是 hot path；M4 收集 Codex 與 Claude Code 的原生記憶，等於拿到背景寫入，又不必自己跑模型。

### Claude Code 為什麼不用向量檢索

<https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny>

- **學：** Claude Code 早期試過 RAG 加本機向量資料庫，後來改成讓 agent 自己用 grep 這類工具搜尋：更簡單，也沒有索引過期、權限與隱私的問題。依據是內部使用經驗，不是公開的對照實驗；原話多由二手來源轉述。
- **對本專案：** 支持「BM25 加 agentic search、MVP 不做 embedding」（plan.md 3.6）。

### 借用與不借用

| 借用 | 來源 | 落在哪 |
| --- | --- | --- |
| 講用途的指示，讓模型判斷什麼值得記 | Anthropic | D10 |
| 開工與第一句話主動注入 | Anthropic、Letta 的核心記憶 | D7 |
| 相關度加新近度加重要性 | Generative Agents | D8 |
| 寫入前比對，由 agent 決定 | Mem0 | D9 |
| 失效而不刪除 | Zep、Graphiti | `supersedes` |

| 不借用 | 原因 |
| --- | --- |
| 另跑模型萃取或整理記憶（Mem0、claude-mem、自動 dreaming） | 要花 token，模型的推論容易混成事實；整理交給使用者要求時的 LLM Wiki |
| 知識圖資料庫（Zep） | Obsidian 的連結本身就是圖 |
| MVP 就做向量檢索 | 字面搜尋加上 agent 自己換詞重搜已經夠強；等評估集證明需要再加 |

## 參考但不照做：Karpathy 的 LLM Wiki

<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>

- **學：** 三層（原始來源、wiki、schema 檔）與三個操作（ingest、query、lint）；index.md 管內容、log.md 管時間。
- **關鍵段落：** index.md 在約 100 份來源、數百頁的規模好用；規模再大就需要真正的搜尋，原文推薦 qmd。
- **為什麼不照做：** 它是 compile：由 LLM 讀筆記、寫整理頁，要花 token，產出的頁面也要維護。Contextbase 只做索引與記憶筆記；LLM Wiki 是它上面的一層，兩者分工而不衝突，見 [plan.md](plan.md) 3.8 節。

## Agent 內建的記憶

這是 M4「收集原生記憶」的來源。下表是 2026-11 在本機觀察到的結構，都是內部格式，會隨版本改變。

| agent | 位置 | 運作方式 |
| --- | --- | --- |
| Claude Code 2.1 | `~/.claude/projects/<專案>/memory/` | 一則一檔，加一份 `MEMORY.md` 索引，每次開工載入前 200 行或 25 KB（依 Anthropic 的記憶文章）；對話紀錄是同一層的 `*.jsonl` |
| Codex 0.163 | `~/.codex/memories/` | 在 `config.toml` 的 `[memories]` 開啟後，每個 session 產生一份摘要（`rollout_summaries/`），合併成 `MEMORY.md`，再濃縮成依工作資料夾分組的 `memory_summary.md`；對話紀錄在 `~/.codex/sessions/`。已經出現 `memories_v2/` |

## 其他交接與跨 agent 記憶

| 專案 | 語言與星數 | 可以學的 | 和本專案的差異 |
| --- | --- | --- | --- |
| [REGT-URRED/CONTEXTBASE](https://github.com/REGT-URRED/CONTEXTBASE)（npm 的 `contextbase`） | JavaScript，0★，2026-10 | 依 README 開頭：一個指令在專案裡建立 `contextbase/` 資料夾，存決定、待辦與變更紀錄，並把更新規則注入 agent 會讀的指示檔 | 記憶放在每個專案裡，正是 v0 放棄的做法。npm 名稱已被它使用，所以本專案的套件名用 `obsidian-contextbase` |
| [gastownhall/beads](https://github.com/gastownhall/beads)（原 steveyegge/beads） | Go，28.6k★ | 用 git 版控的 issue tracker 當 agent 記憶；工作之間有相依關係，可以直接查「下一件能做的事」 | 專注在程式開發的工作項目，不處理知識筆記 |
| [seriousz158/project-continuity](https://github.com/seriousz158/project-continuity) | 93★ | 單一 `.relay/CURRENT.md` 保存目標、任務、阻礙、證據與決定；寫入前做修訂檢查並取得 writer lease，避免兩個 agent 互相覆蓋；沒有證據不能把任務標成完成 | 一個專案一個檔、會被覆寫，所以需要鎖；Contextbase 一則一檔、只新增，不需要鎖 |
| [AVIDS2/memorix](https://github.com/AVIDS2/memorix) | 919★ | 依描述：透過 MCP 讓 Claude Code、Codex、Cursor 共用記憶 | 以寫程式為主，細讀後再比較 |
| [modiqo/waggle](https://github.com/modiqo/waggle) | 602★ | 依描述：交接時傳一個可解析的參照，而不是貼上整段內容 | 針對程式產物的參照 |

## Obsidian 與 MCP

| 專案 | 語言與星數 | 可以學的 | 差異 |
| --- | --- | --- | --- |
| [jacksteamdev/obsidian-mcp-tools](https://github.com/jacksteamdev/obsidian-mcp-tools) | 830★ | Obsidian 外掛加 MCP server，接 Smart Connections 做語意搜尋 | 通用的 vault 存取 |
| [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server) | 702★ | 讀寫、搜尋、精準編輯筆記與 frontmatter；支援 stdio 與 HTTP 兩種傳輸 | 通用的讀寫工具 |
| [istefox/obsidian-mcp-connector](https://github.com/istefox/obsidian-mcp-connector) | TypeScript，132★ | MCP server 直接跑在 Obsidian 外掛裡，使用者從外掛市集安裝即可 | 之後上架時可參考的路線 |
| [Obsidian 官方 CLI](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/) | 1.12.4，2026-02 | agent 可以用 `obsidian search` 等指令操作 vault | 需要 Obsidian 開著；不是記憶系統 |
| [iBlinkQ/llm-wiki-obsidian-blink](https://github.com/iBlinkQ/llm-wiki-obsidian-blink) | 648★ | 依描述：中文的 LLM Wiki 加 Obsidian 實作 | 同樣是 compile 的知識層 |

這些通用 vault 工具提醒我們：agent 本來就能讀寫檔案，**不要重做讀寫功能**。本專案的價值在共用的記憶、自動讀寫與檢索。

## 規格與文件

- MCP 規格與官方 SDK：<https://modelcontextprotocol.io>
- Claude Code hooks：<https://code.claude.com/docs/en/hooks>
- Codex hooks：<https://developers.openai.com/codex/hooks>
- Codex 的 MCP 設定，含 server instructions 的讀法：<https://developers.openai.com/codex/mcp>
- Obsidian Sync 不同步以點開頭的檔案與資料夾：<https://obsidian.md/help/sync/settings>
- CoALA（agent 記憶的四種分類）：Sumers et al., 2023, <https://arxiv.org/abs/2309.02427>
