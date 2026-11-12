# 學習筆記：我能講清楚

plan 第 8 節的學習循環，第 4 步是「寫一段我能講清楚的筆記：做了什麼、為什麼、取捨是什麼」。這份筆記依 roadmap 每個里程碑「要能回答的問題」來寫，每一題都指到實際的程式與量到的數字。

核心函式原本計畫由作者親手寫；這一輪由作者的 agent 寫，所以改用逐行講解（排名與收工 hook 兩段）。

## M0：MCP 的 tools、resources、prompts 差在哪？

見 [m0-findings.md 第 6 節](m0-findings.md)。一句話：差在誰決定要不要用。tools 由模型決定，resources 由應用程式決定，prompts 由使用者決定。Contextbase 的讀寫都要在工作中自動發生，所以用 tools；但 Codex 要等模型發現工具之後才載入它，所以還要靠 hooks 在開工和收工時提醒。

## M1：為什麼用 BM25 而不是 embedding？

### BM25 在算什麼

一篇筆記對一個查詢的分數，是查詢裡每個詞「有多稀有」乘上「在這篇出現得夠不夠多」，再加總：

```text
BM25(筆記, 查詢) = Σ  IDF(詞) × 次數 × (k1 + 1) / (次數 + k1 × (1 − b + b × 筆記長度 ÷ 平均長度))
IDF(詞) = ln((總篇數 − 含這個詞的篇數 + 0.5) ÷ (含這個詞的篇數 + 0.5))
```

- **IDF：** 越少筆記有這個詞，它越能分辨筆記，分數越高。「的」幾乎每篇都有，IDF 接近 0；「宇治」只有幾篇有，IDF 高。
- **k1（SQLite 用 1.2）：** 次數的邊際效益遞減。出現 10 次不會是出現 1 次的 10 倍分。
- **b（SQLite 用 0.75）：** 長度校正。同樣出現一次，短筆記比長筆記更「專注」在這個詞上，分數更高。

評估裡看得到 b 的副作用：「第二天去哪裡」這題，被取代的舊決定「第二天去嵐山」只有兩行，兩個詞都在裡面，BM25 給它 10.55 分，排在新決定前面。BM25 只看字，不知道哪個決定比較新。這就是為什麼要在 BM25 上加排名（D8）。

SQLite FTS5 的 `bm25()` 回傳負數，越小越相關；程式裡取負號變成越大越好。筆記名稱那一欄的權重是內文的 2 倍（`bm25(chunks_fts, 2.0, 1.0)`）。

### 為什麼不用 embedding

- **零設定：** BM25 不需要額外的模型、API 金鑰或背景服務。Node 內建的 SQLite 就有 FTS5，裝好就能用。
- **記憶裡最重要的是專有名詞與日期：** 「宇治」「JR 奈良線」「11/09」用字面比對最準。embedding 擅長的是換句話說，例如「吃什麼」對到「晚餐」。
- **可以解釋：** 每個結果都說得出是哪幾個詞對上、為什麼排在這裡。
- **前人的經驗：** 據二手來源轉述，Claude Code 早期用本機向量資料庫做 RAG，後來改成讓 agent 自己用 grep 搜。Anthropic 的實驗裡，搜尋加上 wiki 比只用其中一種好（數字見 [related-work.md](related-work.md)）。
- **代價要老實講：** 完全換句話說、沒有共同字的查詢，BM25 找不到。評估集裡「第三天晚上吃什麼」找得到「晚餐」的筆記，是因為「第三天」「晚上」對上了，不是因為它懂「吃什麼」等於「晚餐」。混合檢索（BM25 加 embedding）排在 M4。

## M1：中文怎麼斷詞？

中文沒有空格，SQLite 的 `unicode61` 會把一整串中文當成一個詞，所以要先在程式裡切好（`src/text.ts`）。兩種切法：

| | `Intl.Segmenter` 按詞切 | 兩字一組（bigram） |
| --- | --- | --- |
| 怎麼切 | 照 ICU 的詞典：「第二天改去宇治」→ 第二 天 改 去 宇治 | 每兩個相鄰的字：「宇治交通」→ 宇治 治交 交通 |
| 優點 | 詞乾淨，索引小（56 MB） | 不需要詞典，新詞、詞的一部分都找得到 |
| 缺點 | 同一個詞在不同上下文可能切法不同：「期末」在「期末專題」裡被切成一整個詞，單查「期末」找不到 | 跨詞的雜訊：「秋天的」的「天的」對到「第三天的」；索引大一點（63 MB） |
| 量到的 | 15% 的（筆記, 詞）組合單獨查不到 | 全部查得到 |

評估集分不出兩者（兩邊都滿分），能分出差異的是「詞在上下文」的結構性檢查。細節見 [evaluation.md](evaluation.md)。暫定用兩字一組，因為對記憶來說，漏掉一則比多一個雜訊更糟；雜訊靠 BM25 的 IDF 和第一句話注入的門檻壓低。最後由作者決定（D12）。

## M1：索引怎麼保持最新？

`src/store.ts` 的 `sync()`：

1. 掃描 vault，拿到每個 `.md` 檔的修改時間與大小。點開頭的資料夾、`node_modules`、捷徑和排除清單都跳過。
2. 和索引裡記的比對：不同就重讀那一篇，索引有、磁碟沒有的就刪掉。
3. 有記憶變動時，重新推導「誰被取代」和「主題資料夾」。

2,500 篇的 vault，什麼都沒變時約 10 ms，所以每次查詢前都做一次，不需要背景程序監看檔案。

## M1：排名逐行講解（`src/rank.ts`）

```ts
export function finalScore(relevance, facts, current, now) {
  const superseded = facts.superseded ? WEIGHTS.superseded : 1;
  return relevance * typeWeight(facts) * recencyWeight(facts, now) * scopeWeight(facts.location, current) * superseded;
}
```

- `relevance`：BM25 的分數，取了負號，越大越好。
- `typeWeight`：使用者的決定 ×1.3，agent 的決定 ×1.15，事實 ×1.1，進度和一般筆記 ×1。plan 說「模型的提議不等於使用者的決定」，這一行把它變成數字。
- `recencyWeight`：記憶的新近度 = 0.5 + 0.5 × 0.5^(天數 ÷ 30)。今天寫的是 1，30 天前的是 0.75，再舊也不低於 0.5。一般筆記不衰減，因為那是使用者自己的內容，改了才算變。
- `scopeWeight`：`1 + 0.5 × 共同層數 ÷ 目前資料夾的層數`。在「旅行/京都 2026」工作時，同資料夾的記憶 ×1.5，「旅行/東京 2025」的 ×1.25。在 vault 根目錄時一律 ×1，因為 M0 量到 Codex 的 session 全都從根目錄開始，根目錄看不出主題（D7）。
- `superseded`：被取代的 ×0.3，留在結果裡但排到後面，並標示「REPLACED by …」，不會從記憶裡消失。

為什麼用乘的不用加的：每個因素都是「比例」上的調整，乘起來互不干擾；BM25 為 0（完全沒對上）的筆記，不會因為很新就被排上來。

## M2：記憶怎麼在 agent 之間共享？

- **同一份資料：** 記憶是 vault 裡 `Agent Memory/` 的 Markdown 筆記，索引在 vault 的 `.contextbase/`。哪個 agent 都讀寫同一份。
- **每個 session 一個 server：** client 用 stdio 啟動自己的 server 行程；多個行程共用同一個 SQLite 檔（WAL 模式，可以同時讀，寫入排隊）。
- **誰寫的有記錄：** MCP 握手的 `clientInfo.name` 是 `claude-code` 或 `codex-mcp-client`，server 轉成 `agent` 欄位，agent 不必、也不能自己填。

## M2：怎麼自動寫回？

三層，從便宜到貴：

1. **工具說明與用途說明（D10、D11）：** server instructions 和開工 hook 的輸出，開頭都是同一段用途說明，點名 `save` 工具。Codex 要發現工具之後才看得到 instructions，所以開工 hook 是讓它一開始就知道的唯一管道。
2. **寫入前的檢查（D9）：** `save` 先檢查禁用詞、`about` 對不對得到筆記、`supersedes` 對不對得到記憶，最後比對相近的記憶，有問題就退回、說明怎麼修正。
3. **收工 hook 補漏（D4）：** 這一回合可能有東西沒存時，擋一次提醒。

### 收工 hook 逐行講解（`src/hooks.ts` 的 `stop`）

```ts
if (input.stop_hook_active) return "";
```

這一次收工本來就是被擋之後的延續，一定放行，否則會無限迴圈。

```ts
const state = readSession(options.vault, id);
if (!state) return "";
```

沒有 session 狀態，代表開工和送出問題的 hook 沒跑，不知道回合從何時開始，所以不判斷。

```ts
if (savedSince(options.vault, id, state, turnStart)) return "";
```

這一回合已經存過就放行。server 存檔時會把時間記進同一個 session 的狀態檔：Codex 在工具呼叫的 `_meta` 裡帶 session id，Claude Code 放在環境變數。拿不到 session id 時，退回比對「最近一次存的時間」。

```ts
if (state.lastBlockTurn !== null && state.turn - state.lastBlockTurn < 3) return "";
```

擋過之後至少隔 3 回合才再擋（假設 H5）。agent 判斷不必存時，每回合都擋只是浪費 token。

```ts
const changed = changedSince(cwd, turnStart, vault);
if (!changed && quietTurns < 5) return "";
```

回合開始後有檔案被改過，或連續 5 回合沒存，才值得提醒（D4）。掃描最多 5,000 個項目，跳過點開頭的資料夾、`node_modules` 和 `Agent Memory/` 本身。

```ts
return JSON.stringify({ decision: "block", reason: STOP_REASON });
```

兩個 client 都接受這個格式；`reason` 會交給 agent，點名 `save`，並允許它回答「沒有要存的」。M0 在 Codex 實測：被擋一次之後，agent 就存了。

## M3：和 claude-mem、basic-memory 有什麼不同？

| | Contextbase | claude-mem | basic-memory | OpenMemory MCP |
| --- | --- | --- | --- | --- |
| 記憶存在哪 | 使用者的 Obsidian vault，一則一篇筆記 | `~/.claude-mem` | Markdown 檔加本機 SQLite | 本機服務的向量資料庫與 Postgres |
| 誰寫入 | 正在工作的 agent，hooks 提醒 | 旁邊另跑一個 agent 自動記錄 | agent 呼叫工具時 | agent 呼叫工具時 |
| 額外的模型或服務 | 沒有 | 有 | 沒有 | 有（Docker 服務） |
| 自動讀回 | 開工注入近況、第一句話注入相關記憶 | 有 | 要 agent 自己查 | 要 agent 自己查 |
| 跨 agent | Claude Code 與 Codex 都裝；M0 量過兩邊的握手與 hooks 輸入，Codex 的收工提醒實測有效 | 多個 agent | 任何 MCP client | 任何 MCP client |

最大的差別：Contextbase 的記憶就是使用者自己筆記的一部分，在 Obsidian 打開一篇筆記，反向連結就列出所有相關的 agent 記憶。

## 面試時可能被追問的

- **「15% 查不到」是怎麼量的？** 對每篇筆記裡、按詞切認得的每個 2 到 4 字詞，檢查它在上下文中有沒有被切成同一個詞。這是結構性的檢查，不是評估集的分數；其中一部分是本來就不該找到的跨詞巧合。
- **第一句話注入的門檻為什麼是 3？** 假 vault 上，相關問題的分數在 5 到 12.6 之間，不相關的最高 2.8。BM25 會隨 vault 變大，所以這個值要用真實資料重調。
- **被取代的記憶為什麼不刪？** 記憶只新增、不改寫：保留決定的歷史，也不會有兩個 agent 同時改一篇的衝突。被取代只是排名降權並加上標示。
- **hook 失敗會怎樣？** 一律以 exit 0 結束，錯誤寫在 stderr，client 當作沒有東西要補充；記憶系統壞掉，不能拖垮使用者的工作。
- **怎麼證明檢索變好了？** 評估集加上消融：同一組題目，比較有無排名、兩種斷詞。目前的證據是排名修正了 3 題「舊決定排第一」；更大的評估集排在 M4。
