# M0 驗證結果

2026-11-11｜Claude Code 2.1.308、Codex 0.163.0、Node 26.5.0、MCP TypeScript SDK 1.32.2

M0 的目的，是在寫 M1 之前，用真的 Claude Code 和 Codex 檢查 [plan.md](plan.md) 的假設。這份文件記錄量到了什麼、哪些假設成立、哪些要改，以及沒量到的部分。

標記的意思：**實測**是探針直接記下來的資料；**文件**是官方文件的說法（由子 agent 讀取，有些是摘要，不是原文）；**推論**是從實測推出來、沒有直接看到的。

## 1. 先講結論

| 假設 | 結果 | 依據 |
| --- | --- | --- |
| server 拿得到工作資料夾 | 成立：兩邊 server 的 `process.cwd()` 都是 session 的工作資料夾 | 實測 |
| `clientInfo` 能告訴 server 是哪個 agent 在寫 | 成立，但名字是 `claude-code` 與 `codex-mcp-client`，要有對照表 | 實測 |
| server instructions 會被模型讀到 | Claude Code：會（文件、本 session 的系統提示）；Codex：開頭不會，發現工具之後才出現 | 實測、推論 |
| agent 只靠 instructions 就會自己存 | Codex 不成立：3 次裡 0 次 | 實測（次數少） |
| 收工 hook 擋一次，能補上漏存 | Codex 成立：1 次裡 1 次 | 實測（次數少） |
| 兩邊 hooks 的輸入符合預期 | 成立 | 實測（Codex 三種事件、Claude Code 兩種） |
| 裝好 hooks 就會執行 | Codex 不成立：沒經使用者審查信任的 hooks 會被靜默跳過 | 實測 |
| hook 和 server 看得到同一個 session | 成立：兩邊都有可以對上的 session id | 實測 |

需要作者決定的只有一件，已在 11/11 決定：記憶的用途說明放在 instructions 與開工 hook 兩處（D11，[plan.md 第 6 節第 16 點](plan.md)）。其餘是 M1、M2 要照著做的修正（第 4 節）。

## 2. 怎麼量的

- **探針 server**（[`src/server.ts`](../src/server.ts)）：`search` 回傳假資料，`save` 把記憶寫成筆記。[`src/probe.ts`](../src/probe.ts) 把 client 送來的每一則 JSON-RPC 訊息原樣記進檔案，所以握手內容和工具呼叫的 `_meta` 都是實際送出的資料。
- **探針 hook**（[`probe/hook-dump.mjs`](../probe/hook-dump.mjs)）：把 hook 收到的 JSON 記進檔案，並依 client 的格式回傳注入文字，或擋住收工。
- **只掛在單次執行上，沒有動全域設定：** Claude Code 用 `--mcp-config`、`--strict-mcp-config` 與 `--settings`；Codex 用 `--ignore-user-config`、`--ephemeral` 與 `-c`。`~/.claude/` 與 `~/.codex/` 的設定檔沒有被修改。
- **假 vault：** 15 篇合成筆記（其中 4 則是舊記憶），每次實驗重建一份。
- **測試任務：** 「第二天交通那一段還寫著搭 JR 去嵐山。我想了一下，第二天只有半天，所以決定第二天改去宇治、嵐山移到第四天。請照這個決定改行程筆記的交通段落。」任務裡有一個決定，但沒有提到記憶或 Contextbase。

限制：

- **Claude Code 需要模型的測試沒做成。** 獨立的 `claude` 指令在沙盒和 Terminal 裡都顯示未登入（`claude auth status`），只有桌面 app 的 session 能用。所以 Claude Code 只量到握手、環境和前兩種 hook，沒量到「會不會自己存」「Stop hook 補漏」「工具呼叫的 `_meta`」。
- **Codex 的行為測試規模很小。** 只用一個模型（gpt-6.1-sol）、一個任務，每個條件 1–3 次。可以看方向，不能當比例。
- **Codex 的 hooks 要先信任才會跑，`exec` 下沒有審查畫面，所以 hooks 實測用了單次旗標 `--dangerously-bypass-hook-trust`。** 只跑我自己寫的探針 hook，沒有持久化任何信任。這個旗標在三次相同形式的呼叫裡，有兩次被自動模式的分類器擋下，一次沒被擋、跑完了。被擋的兩次（hooks 基本測試、開工 hook 注入用途）沒有補跑。

## 3. 量到的資料

### 3.1 MCP 握手與環境（實測）

| | Claude Code 2.1.308 | Codex 0.163.0 |
| --- | --- | --- |
| `clientInfo.name`（title） | `claude-code`（Claude Code） | `codex-mcp-client`（Codex） |
| 協定版本 | 2025-11-25 | 2025-06-18 |
| client 宣告的能力 | `roots`（含 `listChanged`）、`elicitation` | `elicitation`、`experimental` 裡的 `codex/auth-change`；沒有 `roots` |
| `roots/list` 的回答 | 一個 root：啟動資料夾 | 空陣列 |
| server 的 `process.cwd()` | 啟動資料夾 | session 的工作根目錄（`-C` 指定的資料夾，不是 `codex` 啟動時所在的資料夾） |
| 資料夾有 `.git` 時 | 仍是啟動的子資料夾，不會上跳到 git 根目錄 | 同左 |
| 給 server 的環境變數 | 完整環境，多了 `CLAUDE_PROJECT_DIR`（等於啟動資料夾）和 `CLAUDE_CODE_SESSION_ID` | 精簡環境：`HOME`、`LOGNAME`、`PATH`、`SHELL`、`TMPDIR`、`USER`，加上設定檔 `env` 指定的；沒有 Codex 自己的 session 資訊 |
| 工具呼叫的 `_meta` | 沒量到 | `sessionId`、`threadId`、`callId`、`itemId`、`windowId`、`progressToken`，以及 `x-codex-turn-metadata`（`session_id`、`turn_id`、`model`、`sandbox_mode`、`turn_trigger` 等） |
| server 何時知道 session id | 啟動時（環境變數） | 第一次工具呼叫時（`_meta`） |

一次連線的順序（Codex，從 server 收到的訊息記錄）：client 啟動 server 行程 → `initialize` → `notifications/initialized` → 馬上 `tools/list` → 隔一段時間，模型決定呼叫時才有 `tools/call`。

桌面 app 和 Claudian 這類外掛啟動的 session，工作資料夾和環境可能不同（它們由應用程式指定資料夾），沒有量。

### 3.2 server instructions

- **Claude Code：** server 送出 1535 字元（含探針用的標記）。文件說上限是 4096 字元（2.1.296 之前是 2048），超過會被截斷。這個 session 自己的系統提示裡有「MCP Server Instructions」區塊，列出各 server 的 instructions，可見 Claude Code 會把它放進系統提示（觀察，沒有用探針 server 直接驗證）。
- **Codex（實測）：** 兩次實驗中，模型都說在呼叫任何工具之前看不到 instructions 裡的頭、尾兩個標記，發現 contextbase 的工具之後才兩個都看到。
- **Codex（推論）：** `codex features list` 有一項 `tool_search_always_defer_mcp_tools`（已移除，固定開啟）。合起來看，Codex 預設不把 MCP 工具和 instructions 放進一開始的上下文，模型要先「發現」工具。任務裡沒人提到記憶，它就不會去找，這和下面「只給 instructions 時 0/3 沒存」一致。這是推論：我沒有看到 Codex 送給模型的實際內容。
- **規格怎麼說：** 舊版規格（2025-11-25）的 `InitializeResult.instructions` 註解寫「this information MAY be added to the system prompt」，也就是 client 可以放，不必放，所以 Codex 的做法沒有違反規格。新版（2026-07-28）的 `DiscoverResult.instructions` 也只說「可以被 client 使用」，並建議不要重複工具說明裡已有的資訊。

### 3.3 Hooks

| | Claude Code | Codex |
| --- | --- | --- |
| 設定位置 | `~/.claude/settings.json` 的 `hooks`；單次用 `--settings`（實測可行） | `~/.codex/hooks.json` 或 `config.toml` 的 `[hooks]`，專案層是 `<repo>/.codex/`；單次用 `-c 'hooks.事件=[…]'`（實測可行）。文件 |
| 在非互動模式下會跑嗎 | 會（`-p`：SessionStart、UserPromptSubmit 實測） | 會，但要先信任：沒信任時靜默跳過，沒有警告；用 `--dangerously-bypass-hook-trust` 才跑 |
| SessionStart 的輸入 | `session_id`、`transcript_path`、`cwd`、`hook_event_name`、`source`（`startup`） | 同左，另有 `model`、`permission_mode`；`transcript_path` 在 `--ephemeral` 下是 `null` |
| UserPromptSubmit 的輸入 | 另有 `prompt_id`、`permission_mode`、`prompt` | 另有 `turn_id`、`model`、`permission_mode`、`prompt` |
| Stop 的輸入 | 沒量到。文件：`stop_hook_active`、`last_assistant_message` | `session_id`、`turn_id`、`transcript_path`、`cwd`、`model`、`permission_mode`、`stop_hook_active`、`last_assistant_message`（實測） |
| 擋住收工 | 沒量到。文件：`{"decision":"block","reason":…}`；連續擋 8 次後會被強制放行 | 實測有效：擋一次後 agent 繼續做事，第二次 Stop 的 `stop_hook_active` 是 `true`，放行 |
| 注入文字模型看不看得到 | SessionStart 的 stdout 被記為成功的 hook 回應；模型是否看到沒量到（文件說會） | 沒量到（相關實驗被擋下） |
| session 對應 | hook 的 `session_id` 等於 server 環境變數 `CLAUDE_CODE_SESSION_ID`（實測；我查的四個文件頁面沒提到這個變數） | hook 的 `session_id` 與 `turn_id`，等於 server 在工具呼叫 `_meta` 裡看到的 `sessionId` 與 `turn_id`（實測） |

### 3.4 只有 `save` 時，agent 的行為（Codex，gpt-6.1-sol）

| 條件 | 次數 | 有呼叫 `save` | 備註 |
| --- | --- | --- | --- |
| 明確要求「用 save 記錄這個決定」，沒給任何背景 | 2 | 2/2 | `type`、`decided_by` 都對；`about` 兩次都填成資料夾路徑 `旅行/京都 2026`，在 Obsidian 是失效連結；內文寫「未提供原因」，沒有編造 |
| 任務裡有決定、沒提記憶；只有 server instructions | 3 | 0/3 | 三次都改完檔就結束，完全沒碰 contextbase |
| 同上，加一個 Stop hook：第一次收工時擋下並提醒 | 1 | 1/1 | `about` 填的是 `京都 2026 行程`（agent 先看過 vault 裡的檔名）；有寫原因（只有半天）；`decided_by` 對 |
| 同上，改由開工 hook 注入用途說明 | 0 | — | 沒跑成（見第 2 節） |

### 3.5 核准

`codex exec` 下，`save`（標示 `readOnlyHint: false` 的非唯讀工具）不設任何核准也能執行。但 `exec` 沒有人可以回答確認，所以不能推到互動模式。Codex 的 MCP 設定有 `default_tools_approval_mode` 和 `tools.<工具>.approval_mode`（文件）。Claude Code 的核准沒有量。

## 4. 對設計的影響

1. **D10 的前提不完全成立，用途說明要有第二個管道。** 已決定採用方案 B（D11）：instructions 與開工 hook 的輸出開頭都帶同一段，兩處共用一個常數。
2. **D4（收工 hook）有用而且需要。** 在 Codex，agent 不自己存，但被 Stop hook 提醒一次就存了；`stop_hook_active` 的行為和文件一致。plan 5.6 節照舊。
3. **hook 與 server 不必直接通訊。** 兩邊都拿得到同一個 session id，狀態可以放在 `.contextbase/` 底下以 session id 命名的小檔案：「第一句話是否已經注入」「這個 session 最近一次存是什麼時候」。Codex 另有 `turn_id`，可以精確判斷「這一回合存過沒有」；Claude Code 的回合識別沒量到，改用 UserPromptSubmit 記下回合開始時間來比較。
4. **`agent` 欄位要有對照表。** `claude-code` 對 `claude-code`，`codex-mcp-client` 對 `codex`，不認得的名字照原樣記。
5. **工作資料夾一律用 `process.cwd()`。** 兩邊都等於 session 的工作資料夾。Claude Code 的 `roots` 和 `CLAUDE_PROJECT_DIR` 內容相同，Codex 的 `roots` 是空的，而且新版規格已棄用 `roots`，所以不依賴它。
6. **`save` 要驗證 `about`。** agent 沒看過 vault 就會填資料夾路徑。M1：寫入前把 `about` 解析成真正的筆記，對不到就回傳相近的筆記讓 agent 選，不寫失效連結。這和 D9（寫入前比對）同一個位置，可以一起做。
7. **Codex 的 hooks 需要使用者審查信任，`init` 無法代勞。** `init` 結束時要明確提示使用者在 Codex 裡審查這幾個 hooks（`/hooks`），而且要有檢查指令，能看出 hooks 有沒有真的跑過（名稱 M2 再定）。
8. **核准設定要列進 `init` 的確認清單。** 為 `save` 設定核准（Codex 的 `tools.save.approval_mode`、Claude Code 的允許規則），否則自動寫回可能卡在確認；互動模式的行為 M2 再驗證。這會改使用者的全域設定，必須先列出改動、經同意。
9. **把握手相關的讀取集中在一個模組。** 最新版規格（2026-07-28）拿掉了 `initialize` 握手並棄用 `roots`，而兩個 client 目前還在用舊版（2025-11-25 與 2025-06-18）。`clientInfo`、`roots`、session id 的讀取集中在一個地方，client 升級時只改那裡。
10. **`init` 寫 `node` 的絕對路徑（推論）。** Codex 給 server 的環境只有基本變數；桌面 app 啟動的 client 的 `PATH` 沒量。寫成 `process.execPath` 的絕對路徑，比依賴 `PATH` 穩。

## 5. 沒量到的，以及怎麼補

| 沒量到的 | 為什麼 | 怎麼補 |
| --- | --- | --- |
| Claude Code：會不會自己存、instructions 是否到模型、Stop hook、工具呼叫的 `_meta` | 沙盒與 Terminal 裡的 `claude` 都沒有登入 | 在桌面 app 註冊探針 server 與 hooks 後，用真實工作測（需要改全域設定，先經作者同意） |
| Codex：開工 hook 注入用途說明，agent 會不會因此自己存（D11 採用的做法，目前只是推論） | `--dangerously-bypass-hook-trust` 被自動模式分類器擋下 | 經作者核准該旗標，或在 Codex 裡審查信任探針 hooks 後再測 |
| 互動模式的核准提示（兩邊） | `exec` 與 `-p` 沒有人回答確認 | 真實工作測試時觀察 |
| 用真實 vault 做一次真實工作測試（plan M0 的最後一項） | 要註冊全域設定、寫入真實 vault | 經作者同意後做 |
| 桌面 app 與 Claudian 啟動的 session 的資料夾與環境 | 沒辦法在沙盒裡啟動它們 | 真實工作測試時，從探針紀錄看 |
| Node 版本下限（`node:sqlite` 的 FTS5） | 本機只有 Node 26.5.0 | M1 用 CI 的版本矩陣（Node 22、24、26）測 |

## 6. 我能講清楚：MCP 的 tools、resources、prompts 差在哪

三種能力的差別是**誰決定要不要用**（來源：[MCP 官方文件的 server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)）：

| 能力 | 誰控制 | 舉例 |
| --- | --- | --- |
| Tools | 模型：模型自己發現、自己決定呼叫 | `search`、`save` |
| Resources | 應用程式：客戶端決定要不要把某份資料附進上下文 | 一個檔案、一筆資料庫紀錄 |
| Prompts | 使用者：要明確觸發，例如 slash command | `/checkpoint`（之後要加） |

Contextbase 用 tools，因為記憶要在 agent 工作當中被讀寫，只有 tools 是模型能自己呼叫的。Resources 要客戶端幫模型選資料，兩個 client 的支援程度不同，MVP 不依賴；prompts 要使用者手動觸發，適合之後的 `/checkpoint`。

M0 看到的現實補了一句：tools 雖然是「模型控制」，模型得先知道有這個工具。Codex 把 MCP 工具延後到被發現才載入，沒人提醒就不會用。所以讀寫要分兩層：hooks 由應用程式的生命週期出手提醒（開工注入、收工補漏），tools 負責實際的搜尋與寫入。這也是 plan 一開始就把 hooks 放進 MVP 的理由，M0 用資料支持了它。

## 7. 已決定：D11

記憶的用途說明放在兩處：MCP server instructions，加開工 hook 輸出的開頭，兩處共用程式裡的同一個常數（[plan.md 第 6 節第 16 點](plan.md)）。效果是推論，M2 用第 5 節的測試補驗。

## 8. 重現

假 vault 目前不在 repo 裡（M1 會加 `fixtures/`），下面用 `<repo>`、`<vault>`、`<log>` 代表路徑。

Claude Code（會觸發握手與前兩種 hook，之後因為未登入而在模型呼叫失敗，不影響記錄）：

```bash
cd "<vault>/旅行/京都 2026"
claude -p "測試" \
  --mcp-config mcp.json --strict-mcp-config \
  --allowedTools mcp__contextbase \
  --settings hooks.json --no-session-persistence \
  --output-format stream-json --verbose
```

`mcp.json` 的內容是 `{"mcpServers":{"contextbase":{"command":"node","args":["<repo>/src/server.ts"],"env":{"CONTEXTBASE_VAULT":"<vault>","CONTEXTBASE_PROBE_LOG":"<log>"}}}}`；`hooks.json` 把 SessionStart、UserPromptSubmit、Stop 都指到 `node <repo>/probe/hook-dump.mjs --log <log>`。

Codex：

```bash
codex exec --ignore-user-config --ephemeral --skip-git-repo-check --json \
  -c 'mcp_servers.contextbase.command="node"' \
  -c 'mcp_servers.contextbase.args=["<repo>/src/server.ts"]' \
  -c 'mcp_servers.contextbase.env={CONTEXTBASE_VAULT="<vault>",CONTEXTBASE_PROBE_LOG="<log>"}' \
  -C "<vault>/旅行/京都 2026" "<任務>"
```

要看 hooks 時，再加 `-c 'hooks.Stop=[{hooks=[{type="command",command="node <repo>/probe/hook-dump.mjs --log <log> --stop block"}]}]'`，並且必須信任這些 hooks（單次實驗用 `--dangerously-bypass-hook-trust`，見第 2 節的說明）。

## 9. 資料來源

- Claude Code：[hooks](https://code.claude.com/docs/en/hooks)、[MCP](https://code.claude.com/docs/en/mcp)、[CLI 參考](https://code.claude.com/docs/en/cli-reference)、[設定](https://code.claude.com/docs/en/settings)。
- Codex（`developers.openai.com/codex/*` 會轉址到下列頁面）：[hooks](https://learn.chatgpt.com/docs/hooks)、[MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[設定參考](https://learn.chatgpt.com/docs/config-file/config-reference)、[非互動模式](https://learn.chatgpt.com/docs/non-interactive-mode)。
- MCP：[server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)、[生命週期](https://modelcontextprotocol.io/specification/latest/basic/lifecycle)、[roots](https://modelcontextprotocol.io/specification/latest/client/roots)、[2025-11-25 的 schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts)。
