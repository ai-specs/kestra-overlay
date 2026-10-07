#!/usr/bin/env bash
# check-patches.sh — kestra-overlay 质量门（AGENTS.md §3/§4 的强制执行者）
# 用法：
#   ./scripts/check-patches.sh                       # 结构校验（秒级，无需上游树）
#   ./scripts/check-patches.sh --apply-check <dir>   # 追加：在 <dir>（BASE 干净树）按序应用全部 patch
# 检查项（任一 FAIL → 退出码 1）：
#   BASE 格式 / manifest 结构与状态合法性 / patch 文件与 manifest 一一对应 /
#   目录白名单（仅 webserver 组）/ 头部注释必填字段 / 文件数声明一致 /
#   冲突标记 / 同文件跨 patch 改动行冲突（坐标归一化后） / （可选）顺序应用 + 改动集合核对
# 坐标归一化：增量提交法生成的 patch N 旧行号基于「patch 1..N-1 应用后」的文件；
# 冲突检测先把各 patch 的旧行号按前序 patch 在该文件的累计行数增量折算回 BASE 坐标。
# 权威判定始终是 --apply-check 的真实顺序应用（git apply）；静态检测是无需上游树的快速门。
# bash 3.2 兼容（macOS 默认 shell）。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH_DIR="$REPO/patches"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL  $1"; }

APPLY_DIR=""
if [ "${1:-}" = "--apply-check" ]; then
  APPLY_DIR="${2:?--apply-check 需要一个处于 BASE 的上游树目录}"
fi

TMP_ROWS="$(mktemp)"; TMP_PATCHES="$(mktemp)"; TMP_HUNKS="$(mktemp)"; TMP_FCNT="$(mktemp)"
trap 'rm -f "$TMP_ROWS" "$TMP_PATCHES" "$TMP_HUNKS" "$TMP_FCNT"' EXIT

echo "== [1] patches/BASE 格式 =="
BASE_FILE="$PATCH_DIR/BASE"
if [ ! -f "$BASE_FILE" ]; then
  bad "patches/BASE 缺失"
else
  L1="$(sed -n 1p "$BASE_FILE")"; L2="$(sed -n 2p "$BASE_FILE")"
  if echo "$L1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+'; then ok "release tag: $L1"; else bad "第 1 行不是 release tag: $L1"; fi
  if echo "$L2" | grep -Eq '^[0-9a-f]{40}$'; then ok "commit sha: ${L2:0:12}"; else bad "第 2 行不是 40 位 sha: $L2"; fi
  [ "$(wc -l < "$BASE_FILE" | tr -d ' ')" = "2" ] && ok "恰好 2 行" || bad "应恰好 2 行"
fi

echo "== [2] manifest 结构 =="
MANIFEST="$PATCH_DIR/manifest.tsv"
[ -f "$MANIFEST" ] || { bad "patches/manifest.tsv 缺失"; exit 1; }
awk -F'\t' '/^#/ || /^$/ {next} {print}' "$MANIFEST" > "$TMP_ROWS"
[ -s "$TMP_ROWS" ] && ok "manifest 有数据行" || bad "manifest 无数据行"
bad_rows=$(awk -F'\t' 'NF!=8 {print $1}' "$TMP_ROWS" | wc -l | tr -d ' ')
[ "$bad_rows" = "0" ] && ok "所有行 8 列" || bad "$bad_rows 行不是 8 列（TSV 制表符分隔）"
bad_status=$(awk -F'\t' '$3!="core" && $3!="transition" && $3!="reserved" {print $1": "$3}' "$TMP_ROWS")
[ -z "$bad_status" ] && ok "status 全部合法（core|transition|reserved）" || bad "非法 status → $bad_status"
bad_res=$(awk -F'\t' '$3=="reserved" && $2!="-" {print $1}' "$TMP_ROWS")
[ -z "$bad_res" ] && ok "reserved 行 patch 列均为 '-'" || bad "reserved 行不该有 patch 文件 → $bad_res"
dup=$(awk -F'\t' '{print $1}' "$TMP_ROWS" | sort | uniq -d)
[ -z "$dup" ] && ok "id 唯一" || bad "id 重复 → $dup"

echo "== [3] patch 文件 ↔ manifest 一一对应 + 目录白名单 =="
find "$PATCH_DIR" -name '*.patch' -type f | sort > "$TMP_PATCHES.all" || true
while IFS= read -r p; do
  d="$(basename "$(dirname "$p")")"
  [ "$d" = "webserver" ] || bad "非法 patch 组目录 patches/$d/（build/migration/ui 面禁收，AGENTS.md §2）: $(basename "$p")"
done < "$TMP_PATCHES.all"
awk -F'\t' '$2!="-" {print "'"$PATCH_DIR"'/webserver/" $2}' "$TMP_ROWS" | sort > "$TMP_PATCHES"
missing="$(comm -13 "$TMP_PATCHES" "$TMP_PATCHES.all"; comm -23 "$TMP_PATCHES" "$TMP_PATCHES.all")"
if [ -z "$missing" ]; then
  ok "manifest 与 patches/webserver/ 完全对应（$(wc -l < "$TMP_PATCHES" | tr -d ' ') 个 patch）"
else
  bad "不对应 → $(echo "$missing" | tr '\n' ' ')"
fi
reserved_n=$(awk -F'\t' '$3=="reserved"' "$TMP_ROWS" | wc -l | tr -d ' ')
ok "reserved 待激活点 ${reserved_n} 条（对应 docs/oss-ee-gap.md §4）"

echo "== [4] 逐 patch 结构（命名/头部字段/冲突标记/改动行解析）==="
ORDER=0
while IFS= read -r p; do
  ORDER=$((ORDER+1))
  name="$(basename "$p")"
  echo "$name" | grep -Eq '^[0-9]{4}-[a-z0-9-]+\.patch$' || bad "$name: 命名不符 NNNN-slug.patch"
  first_diff_line=$(grep -n '^diff --git ' "$p" | head -1 | cut -d: -f1)
  if [ -z "$first_diff_line" ]; then bad "$name: 无 diff --git（不是 patch?）"; continue; fi
  # diff 体之后只允许 patch 格式行（头部散文注释只能在 diff 之前）
  if tail -n +"$first_diff_line" "$p" | awk '
        /^diff --git / || /^index / || /^--- / || /^\+\+\+ / || /^@@ / || /^new file mode/ ||
        /^[ +\\-]/ || /^$/ { next }
        { found=1; exit }
      END { exit(found ? 0 : 1) }'; then
    bad "$name: diff 体后混入散文（头部注释只能在 diff 之前）"
  fi
  for field in 需求 消费扩展仓 状态 来源 触达上游文件 移除条件; do
    head -n "$((first_diff_line-1))" "$p" | grep -q "$field" || bad "$name: 头部缺字段「$field」"
  done
  grep -Eq '^\+?(<<<<<<<|>>>>>>>)' "$p" && bad "$name: 含冲突标记"
  # 输出（组前置）：C <order> <file> <delta> <patch> 后跟本组 D/I 记录：
  #   D <oldline>  被 '-' 的旧行；I <point> 插在旧第 point 行之前的 '+' 段首
  awk -v order="$ORDER" -v patch="$name" '
    function flushgroup(   ) {
      if (cur != "") {
        printf "C\t%d\t%s\t%d\t%s\n", order, cur, curplus-curminus, patch
        printf "%s", buf
      }
      buf=""
    }
    /^diff --git a\// { flushgroup(); path=$0; sub(/^diff --git a\/[^ ]+ b\//, "", path)
                        cur=path; files[cur]=1; isnew=0; curplus=0; curminus=0 }
    /^new file mode/ { isnew=1 }
    /^@@ / { split($3, o, ","); os=o[1]; sub(/^-/, "", os); old=os+0; inhunk=1; lastplus=0 }
    inhunk && /^diff --git / { inhunk=0 }
    inhunk && /^-/ { if (!isnew) buf = buf "D\t" old "\n"; old++; curminus++; lastplus=0 }
    inhunk && /^\+/ { if (!lastplus && !isnew) buf = buf "I\t" old "\n"
                      curplus++; lastplus=1 }
    inhunk && (/^ / || /^$/) { old++; lastplus=0 }
    END { flushgroup(); cnt=0; for (f in files) cnt++; print patch "\t" cnt > "'"$TMP_FCNT"'" }
  ' "$p" >> "$TMP_HUNKS"
done < "$TMP_PATCHES"
ok "解析完成（改动行记录 $(wc -l < "$TMP_HUNKS" | tr -d ' ') 条）"

echo "== [5] manifest 文件数声明 ↔ patch 实际触达 =="
fcnt_bad=0
while IFS=$'\t' read -r pname actual; do
  declared=$(awk -F'\t' -v n="$pname" '$2==n {print $6}' "$TMP_ROWS")
  if [ "$declared" != "$actual" ]; then
    bad "$pname: manifest 声明触达 ${declared:-?} 个文件，patch 实际 $actual"
    fcnt_bad=$((fcnt_bad+1))
  fi
done < "$TMP_FCNT"
[ "$fcnt_bad" = "0" ] && ok "文件数声明全部一致"

echo "== [6] 同文件跨 patch 改动行冲突（坐标归一化后比较）==="
conflict=$(awk -F'\t' '
  $1=="C" { gfile=$3; gpatch=$5; goff=cum[gfile]; cum[gfile]+=$4; next }
  $1=="D" { print "D\t" gfile "\t" ($2-goff) "\t" gpatch; next }
  $1=="I" { print "I\t" gfile "\t" ($2-goff) "\t" gpatch }
' "$TMP_HUNKS" | awk -F'\t' '
  $1=="D" { k=$2 SUBSEP $3; if ((k in downer) && downer[k] != $4)
              print "    " $2 ": 旧行 " $3 " 被 patch[" downer[k] "] 与 patch[" $4 "] 同时改写"
            downer[k]=$4 }
  $1=="I" { ik[$2 SUBSEP $3] = ik[$2 SUBSEP $3] " " $4 }
  END {
    for (k in ik) {
      split(k, p, SUBSEP); f=p[1]; pt=p[2]+0
      if ((k in downer)) {
        split(ik[k], plist, " ")
        for (i in plist) if (plist[i] != downer[k])
          print "    " f ": patch[" plist[i] "] 的插入点落在 patch[" downer[k] "] 删除的旧行 " pt " 上"
      }
    }
  }')
if [ -z "$conflict" ]; then ok "无跨 patch 改动行冲突"; else bad "存在冲突（同文件多需求拆分时改动行不得互侵占）:"; echo "$conflict"; fi

echo "== [7] transition 行必须声明收窄后形态 =="
hits=$(awk -F'\t' '$3=="transition" && $8 !~ /收窄/ {print "    " $1 ": 移除条件列未写明收窄后剩什么"}' "$TMP_ROWS")
if [ -z "$hits" ]; then ok "transition 行均声明收窄形态"; else bad "transition 收窄声明缺失:"; echo "$hits"; fi

if [ -n "$APPLY_DIR" ]; then
  echo "== [8] apply-check dir: $APPLY_DIR =="
  if ! git -C "$APPLY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    bad "不是 git 树: $APPLY_DIR"
  else
    dirty=$(git -C "$APPLY_DIR" status --porcelain | head -3)
    [ -z "$dirty" ] && ok "工作树干净" || bad "工作树不干净（必须从 BASE 干净树开始）"
    applied=0; total=$(wc -l < "$TMP_PATCHES" | tr -d ' ')
    while IFS= read -r p; do
      if git -C "$APPLY_DIR" apply --check "$p" 2>/tmp/check-patches-apply.err; then
        git -C "$APPLY_DIR" apply "$p"
        applied=$((applied+1))
      else
        bad "$(basename "$p"): apply 失败 → $(head -2 /tmp/check-patches-apply.err | tr '\n' ' ')"
        break
      fi
    done < "$TMP_PATCHES"
    if [ "$applied" = "$total" ]; then
      changed=$(git -C "$APPLY_DIR" status --porcelain | awk '{print $2}' | sort -u)
      declared_union=$(awk '/^diff --git a\// { path=$0; sub(/^diff --git a\/[^ ]+ b\//, "", path); print path }' $(cat "$TMP_PATCHES") | sort -u)
      mismatch=$(printf '%s\n%s\n' "$changed" "$declared_union" | sort | uniq -u)
      [ -z "$mismatch" ] && ok "顺序应用 $applied/$total 全部成功，改动集合与声明一致" \
                          || bad "改动集合与声明不符 → $(echo "$mismatch" | tr '\n' ' ')"
    fi
  fi
fi

echo
echo "结果: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" = "0" ]; then echo "ALL CHECKS PASSED"; else exit 1; fi
