# 相關專案與可以學的地方

> 2026-11-09 整理。星數與更新日期是當天 GitHub 上的數字。標「依描述」的只讀過 repo 簡介，還沒細讀。

## 最該先讀的三個

### 1. Karpathy：LLM Wiki（gist）

<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>

- **學：** 三層（原始來源、wiki、schema 檔）與三個操作（ingest、query、lint）；index.md 管內容、log.md 管時間，兩者分工。
- **關鍵段落：** index.md 在約 100 份來源、數百頁的規模好用，可以省掉 embedding RAG；規模再大就需要真正的搜尋，原文推薦 qmd。
- **差異：** 它處理知識，不處理「誰決定了什麼、做到哪裡」。

### 2. tobi/qmd

<https://github.com/tobi/qmd>｜TypeScript｜31k★

- **學：** 本機 Markdown 搜尋的完整管線：BM25（SQLite FTS5）加向量檢索，再用本機 LLM 重排序；同時提供 CLI 與 MCP server。
- **差異：** 通用搜尋引擎，沒有範圍、決定與交接的概念。

### 3. basicmachines-co/basic-memory

<https://github.com/basicmachines-co/basic-memory>｜Python｜4.5k★｜AGPL-3.0

- **學：** Markdown 檔是權威、SQLite 只是索引，兩者雙向同步；entity、observation、relation 的筆記格式；每個工具標註唯讀、破壞性、可重複執行等行為提示。
- **差異：** 使用自己的筆記格式與資料夾，不是疊在既有 vault 上；沒有範圍繼承。授權是 AGPL，本專案是 MIT，所以只參考設計，不複製程式碼。

## 交接與跨 agent 記憶

| 專案 | 語言與星數 | 可以學的 | 和本專案的差異 |
| --- | --- | --- | --- |
| [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) | TypeScript，115k★ | 用 hooks 自動擷取 session；新 session 開頭注入精簡索引；索引、時間線、細節三層漸進揭露 | 由第二個 agent 自動摘要所有操作，存在 SQLite 而不是 vault；模型推論和事實容易混在一起 |
| [gastownhall/beads](https://github.com/gastownhall/beads)（原 steveyegge/beads） | Go，28.6k★ | 用 git 版控的 issue tracker 當 agent 記憶；工作之間有相依關係，可以直接查「下一件能做的事」 | 專注在程式開發的工作項目，不處理知識筆記 |
| [seriousz158/project-continuity](https://github.com/seriousz158/project-continuity) | 93★ | 單一 `.relay/CURRENT.md` 保存目標、任務、阻礙、證據與決定；寫入前做修訂檢查並取得 writer lease，避免兩個 agent 互相覆蓋；沒有證據不能把任務標成完成 | 一個專案一個檔，沒有範圍階層，也沒有檢索 |
| [AVIDS2/memorix](https://github.com/AVIDS2/memorix) | 919★ | 依描述：透過 MCP 讓 Claude Code、Codex、Cursor 共用記憶 | 以寫程式為主，細讀後再比較 |
| [modiqo/waggle](https://github.com/modiqo/waggle) | 602★ | 依描述：交接時傳一個可解析的參照，而不是貼上整段內容 | 針對程式產物的參照 |

## Obsidian 與 MCP

| 專案 | 語言與星數 | 可以學的 | 差異 |
| --- | --- | --- | --- |
| [jacksteamdev/obsidian-mcp-tools](https://github.com/jacksteamdev/obsidian-mcp-tools) | 830★ | Obsidian 外掛加 MCP server，接 Smart Connections 做語意搜尋 | 通用的 vault 存取 |
| [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server) | 702★ | 讀寫、搜尋、精準編輯筆記與 frontmatter；支援 stdio 與 HTTP 兩種傳輸 | 通用的讀寫工具 |
| [istefox/obsidian-mcp-connector](https://github.com/istefox/obsidian-mcp-connector) | TypeScript，132★ | MCP server 直接跑在 Obsidian 外掛裡，使用者從外掛市集安裝即可 | 之後上架時可參考的路線 |
| [Obsidian 官方 CLI](https://obsidian.md/changelog/2026-02-27-desktop-v1.12.4/) | 1.12.4，2026-02 | agent 可以用 `obsidian search` 等指令操作 vault | 需要 Obsidian 開著；不是記憶系統 |
| [iBlinkQ/llm-wiki-obsidian-blink](https://github.com/iBlinkQ/llm-wiki-obsidian-blink) | 648★ | 依描述：中文的 LLM Wiki 加 Obsidian 實作 | 同樣是知識層，不處理交接 |

這些通用 vault 工具提醒我們：agent 本來就能讀寫檔案，**不要重做讀寫功能**。本專案的價值在範圍、紀錄格式與檢索。

## 規格與文件

- MCP 規格與官方 SDK：<https://modelcontextprotocol.io>
- Claude Code hooks：<https://code.claude.com/docs/en/hooks>
- Codex hooks：<https://developers.openai.com/codex/hooks>
- Codex 的 MCP 設定：<https://developers.openai.com/codex/mcp>
- CoALA（agent 記憶的四種分類）：Sumers et al., 2023, <https://arxiv.org/abs/2309.02427>
