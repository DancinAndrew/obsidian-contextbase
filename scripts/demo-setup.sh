#!/usr/bin/env bash
# Prepares a vault for the M3 two-way demo (docs/demo.md): a copy of fixtures/vault with no
# agent memories yet. It installs nothing; run `contextbase init` on it yourself.
# usage: scripts/demo-setup.sh <new or empty folder>
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:?usage: scripts/demo-setup.sh <new or empty folder>}"

if [ -e "$target" ] && [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
  echo "$target is not empty; pick a new folder." >&2
  exit 1
fi

mkdir -p "$target"
cp -R "$repo/fixtures/vault/." "$target/"
rm -rf "$target/Agent Memory" "$target/私人" "$target/.contextbase"

# The fixture vault already holds the outcome of the demo's first decision (day 2 moved to Uji,
# with the reason in the 11-09 diary), because the ranking tests need it. The demo copy goes back
# to the plan before that decision, so what Codex changes and records is new, and the reason can
# only be found in Codex's memory.
cat > "$target/旅行/京都 2026/京都 2026 行程.md" <<'EOF'
# 京都 2026 行程

- 第一天：抵達京都車站，下午去伏見稻荷大社，晚上住四條烏丸。
- 第二天：嵐山半天，竹林小徑與渡月橋。
- 第三天：清水寺、二年坂，晚上在祇園吃飯。
- 第四天：宇治一整天，平等院與宇治川散步，買宇治抹茶。
- 第五天：錦市場買伴手禮，傍晚搭 Haruka 去關西機場。

## 交通

第二天從京都車站搭 JR 嵯峨野線到嵯峨嵐山站，約 15 分鐘。第四天搭 JR 奈良線到宇治，約 30 分鐘。其他天以巴士和地鐵為主，見[[交通與票券]]。
EOF
cat > "$target/日記/2026-11-09.md" <<'EOF'
# 2026-11-09

餐廳還沒訂，第三天晚上想吃京料理。
EOF

echo "Demo vault ready: $target"
echo "Its itinerary is the plan before the demo's first decision: day 2 Arashiyama, day 4 Uji."
echo "Next: contextbase init --vault \"$target\"   (prints the changes; add --yes to apply them)"
