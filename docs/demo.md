# M3 雙向示範：步驟與檢查表

驗收條件（CV 補完清單）：agent A 在非寫程式的工作中記下一個決定，agent B 在新的 session 自己找回它；兩個方向各做一次。這份文件是腳本，實際操作兩個 agent 與錄影由作者來做（見 [assumptions.md](assumptions.md) 的 X1）。

## 事前準備

- Node.js 22.13 以上。
- Claude Code 已登入。終端機版的 `claude` 若顯示未登入，可以用桌面 app，把示範資料夾當成工作資料夾開 session。
- Codex 已登入，而且週額度夠用：一次示範大約 4 個 Codex 回合。
- 從原始碼安裝（還沒發佈到 npm）。先打包再安裝打包檔：直接 `npm install -g .` 只會建一個捷徑指回 repo，之後改 repo 就會改到已安裝的版本。

```bash
git clone https://github.com/DancinAndrew/obsidian-contextbase.git
cd obsidian-contextbase
npm install
npm pack
npm install -g ./obsidian-contextbase-0.0.0.tgz
```

裝好後 `contextbase --version` 應該印出版本號。

## 1. 建示範用的 vault

```bash
scripts/demo-setup.sh ~/contextbase-demo
```

它把 repo 裡的假 vault（京都行程、課程、生活筆記）複製過去，但不含任何 agent 記憶，示範從零開始。

假 vault 為了測試排名，已經寫好第一個決定的結果（第二天改去宇治，理由寫在 11/09 的日記）。示範用的副本會改回決定之前的行程：第二天嵐山、第四天宇治，並刪掉日記裡那一句。這樣 Codex 改的是新東西，「為什麼改」也只存在 Codex 的記憶裡，Claude Code 答得出來，就證明它取回了記憶。

## 2. 只在示範 vault 安裝

```bash
contextbase init --vault ~/contextbase-demo
```

先看印出的改動清單：每一項都只影響這個示範資料夾。確認後加 `--yes` 再跑一次。

接著開一次 Codex：

```bash
cd ~/contextbase-demo && codex
```

- Codex 問要不要信任這個資料夾時，選信任。
- 輸入 `/hooks`，信任三個 Contextbase hooks（指令裡有 `contextbase` 和 `hook`）。

最後跑 `contextbase doctor --vault ~/contextbase-demo`，除了「hooks 還沒跑過」之外都應該是 ✓。

## 3. 方向一：Codex 記下，Claude Code 找回

1. 在示範 vault 開 Codex，輸入：

   > 第二天只有半天，嵐山太趕。我決定第二天改去宇治，嵐山移到第四天。幫我改好「京都 2026 行程」，包括交通段落。

2. 預期：
   - Codex 對調行程表的第二天與第四天，並改好交通段落（第二天搭 JR 奈良線到宇治）。
   - Codex 自己呼叫 `save`；如果沒有，收工時 hook 會擋一次提醒它，它接著存。
   - `Agent Memory/<年-月>/` 出現一篇 `type: decision`、`decided_by: user`、`agent: "codex"` 的筆記。
3. 開一個新的 Claude Code session，用示範 vault 當工作資料夾，輸入：

   > 第二天為什麼不去嵐山了？

4. 預期：
   - 回答前，第一句話的 hook 注入 `[Contextbase] Memories related to this request:`，帶出 Codex 剛記下的決定。注入只有記憶的摘要和路徑。
   - Claude Code 用 `fetch`（或直接讀檔）打開那篇記憶，看到內文寫的理由。畫面上這個工具呼叫，就是「取回另一個 agent 的記憶」最清楚的一幕。
   - 回答說出理由：第二天只有半天，嵐山太趕。行程表只看得到新的安排，看不到理由；理由只在 Codex 的記憶裡。
   - 如果 Codex 改行程時順手把理由也寫進了行程表，就改指向注入的記憶和記憶筆記的 `agent: "codex"`。

## 4. 方向二：Claude Code 記下，Codex 找回

1. 在同一個 Claude Code session 輸入：

   > 第三天晚餐我決定訂祇園那家京料理，晚上七點，已經訂好了。

2. 預期：Claude Code 存下一則記憶（決定或進度），`agent: "claude-code"`。
3. 開一個新的 Codex session，輸入：

   > 第三天晚上的安排是什麼？訂好了嗎？

4. 預期：開工注入的近況，或第一句話的注入，帶出「祇園京料理、晚上七點、已訂好」，Codex 的回答引用它。餐廳清單只寫「候選有兩家、要提前兩週預約」，「七點」和「已訂好」只在 Claude Code 的記憶裡。

## 5. 收尾畫面

- 在 Obsidian 打開示範 vault 的「京都 2026 行程」：反向連結面板列出兩個 agent 寫的記憶。
- `contextbase doctor --vault ~/contextbase-demo`：兩邊的 hooks 都顯示最近執行的時間。
- 打開兩篇記憶筆記，指出 `agent`、`decided_by`、`about` 這幾個欄位。

## 錄影建議

- 分兩段錄，各 1–2 分鐘；每段開頭先講要示範什麼。
- 錄之前清掉其他終端機分頁與通知；畫面左邊放 agent，右邊放 Obsidian。
- 不需要剪掉 agent 思考的時間，但可以加速。

## 如果沒有照預期

| 現象 | 可能原因 | 怎麼辦 |
| --- | --- | --- |
| Codex 改完檔沒有存 | hooks 沒有被信任，收工提醒沒跑 | `contextbase doctor` 看 Codex hooks 是否信任；在 Codex 執行 `/hooks` |
| Claude Code 沒有注入記憶 | session 不是從示範 vault 開的 | 確認工作資料夾是示範 vault 的根目錄 |
| Claude Code 只說行程改了，沒說理由 | 注入只帶記憶的摘要，理由在記憶的內文 | 追問「理由是什麼？」，它會打開那篇記憶 |
| `save` 回覆「Not saved: about must name notes」 | agent 把 `about` 填成資料夾 | 這是預期的保護；agent 會照建議的筆記名稱再存一次 |
| `save` 回覆「Not saved yet: these memories look similar」 | 已有相近的記憶 | 預期行為：agent 選擇取代、照樣新增或放棄 |

這些情況本身也是有用的觀察，記下來即可，不必重錄。

## 拆掉

```bash
contextbase uninstall --vault ~/contextbase-demo --yes
rm -rf ~/contextbase-demo
```
