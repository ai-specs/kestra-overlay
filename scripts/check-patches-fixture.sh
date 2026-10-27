#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/patches/webserver"
cp "$REPO/scripts/check-patches.sh" "$fixture/scripts/"
printf 'v0.0.1\n0000000000000000000000000000000000000000\n' > "$fixture/patches/BASE"
cp "$REPO/patches/IMAGE_BASE" "$fixture/patches/IMAGE_BASE"
header() {
  printf '# 需求: fixture\n# 消费扩展仓: fixture\n# 状态: core\n# 来源: fixture\n# 触达上游文件: fixture.txt\n# 移除条件: never\n'
}
patch() {
  header
  printf 'diff --git a/fixture.txt b/fixture.txt\n--- a/fixture.txt\n+++ b/fixture.txt\n'
  cat
}
run_case() {
  expected="$1"
  if bash "$fixture/scripts/check-patches.sh" > "$fixture/result" 2>&1; then actual=pass; else actual=fail; fi
  if [ "$actual" != "$expected" ]; then cat "$fixture/result"; exit 1; fi
  echo "PASS: $2"
}
printf '0010\t0010-first.patch\tcore\tfixture\tfirst\t1\tfixture\tnever\n0020\t0020-second.patch\tcore\tfixture\tsecond\t1\tfixture\tnever\n' > "$fixture/patches/manifest.tsv"
patch > "$fixture/patches/webserver/0010-first.patch" <<'EOF'
@@ -10,1 +10,2 @@
 ten
+added
EOF
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -1,1 +1,1 @@
-one
+changed
EOF
run_case pass 'later insertion does not shift an earlier line'
patch > "$fixture/patches/webserver/0010-first.patch" <<'EOF'
@@ -1,1 +1,2 @@
+added
 one
EOF
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -2,1 +2,1 @@
-one
+changed
EOF
run_case pass 'earlier insertion maps a later original line'
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -1,1 +1,1 @@
-added
+changed
EOF
run_case fail 'rewriting a preceding patch added line is rejected'
{
  header
  printf 'diff --git a/fixture.txt b/fixture.txt\nnew file mode 100644\n--- /dev/null\n+++ b/fixture.txt\n'
  cat <<'EOF'
@@ -0,0 +1,2 @@
+one
+two
EOF
} > "$fixture/patches/webserver/0010-first.patch"
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -1,1 +1,1 @@
-one
+changed
EOF
run_case pass 'initial creation is unmodified baseline'
printf '0030\t0030-third.patch\tcore\tfixture\tthird\t1\tfixture\tnever\n' >> "$fixture/patches/manifest.tsv"
patch > "$fixture/patches/webserver/0030-third.patch" <<'EOF'
@@ -1,1 +1,1 @@
-changed
+again
EOF
run_case fail 'a line in a created file cannot be rewritten twice'
printf '0010\t0010-first.patch\tcore\tfixture\tfirst\t1\tfixture\tnever\n0020\t0020-second.patch\tcore\tfixture\tsecond\t1\tfixture\tnever\n' > "$fixture/patches/manifest.tsv"
mv "$fixture/patches/webserver/0030-third.patch" "$fixture/third.saved"
patch > "$fixture/patches/webserver/0010-first.patch" <<'EOF'
@@ -1,2 +1,1 @@
-one
 two
EOF
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -1,1 +1,1 @@
-two
+changed
EOF
run_case pass 'deletion maps the next untouched original line'
patch > "$fixture/patches/webserver/0010-first.patch" <<'EOF'
@@ -0,0 +1,1 @@
+inserted
EOF
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -0,0 +1,1 @@
+second
EOF
run_case fail 'same insertion boundary is rejected'
patch > "$fixture/patches/webserver/0010-first.patch" <<'EOF'
@@ -1,1 +1,2 @@
 one
+first
@@ -4,1 +5,2 @@
 four
+last
EOF
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -3,1 +3,1 @@
-two
+changed
EOF
run_case pass 'multiple hunks preserve untouched provenance between edits'
patch > "$fixture/patches/webserver/0010-first.patch" <<'EOF'
@@ -1,5 +1,5 @@
 one

 three
 four
-five
+first
EOF
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -2,3 +2,3 @@

-three
+middle
 four
EOF
printf 'one\n\nthree\nfour\nfive\n' > "$fixture/fixture.txt"
(cd "$fixture" && git apply --check patches/webserver/0010-first.patch && git apply patches/webserver/0010-first.patch && git apply --check patches/webserver/0020-second.patch)
run_case pass 'bare empty context preserves untouched original line provenance'
patch > "$fixture/patches/webserver/0020-second.patch" <<'EOF'
@@ -4,2 +4,2 @@
 four
-first
+second
EOF
(cd "$fixture" && git apply --check patches/webserver/0020-second.patch)
run_case fail 'bare empty context still rejects rewriting a preceding added line'
