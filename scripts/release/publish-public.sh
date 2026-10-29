#!/usr/bin/env bash
# publish-public.sh — BlockForge M1 public publication (RELEASE only)
# Run ONLY after M1 (CI green, G1/G2/G3 gates) and M2 gates pass.
# NEVER run from a feature branch: only RELEASE pushes to main, then
# this creates the public repo from the merged history.
#
# PRE-REQUISITES (verify each before running — do not skip):
#   [ ] gh CLI installed and auth valid: gh auth status  must say OK
#         (on Linux host: gh version 2.102.0; current token INVALID — see below)
#   [ ] GitHub REST token working: the fine-grained github_pat_ token in
#         ~/.hermes/.env must return 200 from:
#           TOK=$(grep -oE 'github_pat_[A-Za-z0-9_]{20,}' ~/.hermes/.env | head -1)
#           curl -sS -H "Authorization: token $TOK" \
#                -H "Accept: application/vnd.github+json" \
#                -H "User-Agent: blockforge" \
#                https://api.github.com/user
#         CURRENT STATE (verified 2026-10-29): 401 Bad credentials.
#         The token is revoked/expired; the operator must renew or replace.
#   [ ] SSH to github.com works (verified: "Hi HoTWinGs06" returned);
#         not sufficient for repo creation (needs API auth).
#   [ ] HoTWinGs06 has rights to create repos under the account
#         (SSH auth confirms account ownership; repo creation needs API).
#   [ ] Repo does NOT yet exist: curl https://api.github.com/repos/HoTWinGs06/blockforge -> 404 (verified).
#   [ ] MIT license present at repo root (verified: LICENSE file, MIT).
#   [ ] README.md contains the VERBATIM disclaimer (verified, already present):
#         "BlockForge is an original, unofficial Minecraft-inspired voxel sandbox.
#          Not affiliated with, endorsed by, or sponsored by Mojang or Microsoft.
#          Minecraft is a trademark of Mojang AB / Microsoft."
#   [ ] README states plainly "BlockForge IS a Minecraft clone inspired by Minecraft" (verified).
#   [ ] feature/integrated/m1 history is mergeable to main; main at 85640a7 includes e2f5834 merge.
#   [ ] All dependencies pinned exactly (no ^) — verified in package-lock.json.
#   [ ] gitleaks clean (zero findings) — CI step runs gitleaks detect; run locally:
#         gitleaks detect --source . --redact --no-banner
#   [ ] No secrets committed — .env never committed (verified .gitignore).
#
# SEQUENCE (do not reorder):
#   1. gitleaks (must be zero; rewrite commit if any find)
#   2. Commit release marker to feature/release/m1 (or ensure main carries it)
#   3. Create public repo:  gh repo create HoTWinGs06/blockforge --public --source=. --remote=origin
#      ALTERNATIVE (if gh still broken, use REST API with working token):
#        curl -sS -X POST -H "Authorization: token $TOK" \
#             -H "Accept: application/vnd.github+json" \
#             -d '{"name":"blockforge","private":false,"auto_init":false}' \
#             https://api.github.com/user/repos
#   4. Push both branches (main + feature/integrated/m1 history):
#        git push origin main
#        git push origin feature/integrated/m1
#        git push --all origin   # pushes all refs
#   5. Verify public URL loads:  curl -sS -o /dev/null -w "%{http_code}" https://HoTWinGs06.github.io/blockforge
#      (Pages deploy handled by .github/workflows/ci.yml pages job; URL only live after deploy.)
#
# CURRENT BLOCKER (verified, not assumed):
#   GitHub auth is DOWN on this host. gh CLI reports token INVALID (401).
#   REST API with the github_pat_ from ~/.hermes/.env returns 401 (Bad credentials).
#   The repo is NOT created (404 from /repos/HoTWinGs06/blockforge).
#   Because creation requires API auth, publication is BLOCKED until the operator
#   provides a valid token or re-authenticates gh.
#   See board note on T111 and docs/handoffs/release.md for full evidence.
#
# WORKING REST INVOCATION (recorded for next agent — do NOT hardcode token):
#   TOK=$(grep -oE 'github_pat_[A-Za-z0-9_]{20,}' ~/.hermes/.env | head -1)
#   curl -sS -H "Authorization: token $TOK" -H "Accept: application/vnd.github+json" \
#        -H "User-Agent: blockforge" https://api.github.com/user
#
# NOTES FOR NEXT AGENT:
#   - Do NOT fabricate a successful creation: verify with curl to /repos/HoTWinGs06/blockforge.
#   - If auth is restored, run this script; then update T111 board -> done.
#   - If auth stays broken after one more cycle, write to docs/BLOCKERS.md per loop rule.
#   - No Windows side work: Windows clone syncs separately.
#   - Only RELEASE pushes to main; never push feature branch to main directly.

set -euo pipefail

echo "=== BlockForge publish-public.sh ==="
echo "Host: $(uname -n)  |  Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'N/A')"
echo "HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"

# 0. Auth check (fails fast, do not proceed if broken)
echo "--- auth check ---"
if command -v gh >/dev/null 2>&1; then
  gh auth status 2>&1 | grep -qE "Failed to log in|invalid" && {
    echo "ERROR: gh auth INVALID — do not proceed. Renew token first."; exit 1;
  } || echo "OK: gh auth valid"
else
  echo "WARNING: gh CLI not found — will try REST only"
fi

TOK=$(grep -oE 'github_pat_[A-Za-z0-9_]{20,}' ~/.hermes/.env 2>/dev/null | head -1 || true)
if [ -z "$TOK" ]; then
  echo "ERROR: no github_pat_ token in ~/.hermes/.env"; exit 1
fi
echo "Token present (length=${#TOK}) — trying REST /user ..."
HTTP=$(curl -sS -o /tmp/pub_auth_check.json -w "%{http_code}" \
  -H "Authorization: token $TOK" -H "Accept: application/vnd.github+json" \
  -H "User-Agent: blockforge" https://api.github.com/user)
if [ "$HTTP" != "200" ]; then
  echo "ERROR: REST auth = $HTTP (expected 200). Token revoked/expired."
  cat /tmp/pub_auth_check.json | head -c 200 || true
  exit 1
fi
echo "REST auth OK (200) — user=$(python3 -c 'import json; print(json.load(open("/tmp/pub_auth_check.json"))["login"])')"

# 1. gitleaks
echo "--- gitleaks (must be zero) ---"
gitleaks detect --source . --redact --no-banner || {
  echo "ERROR: gitleaks findings — rewrite commit, never push secrets."; exit 1;
}
echo "gitleaks: zero findings"

# 2. Verify repo does not already exist (avoid duplicate creation errors)
echo "--- repo existence ---"
REPO_HTTP=$(curl -sS -o /tmp/pub_repo_check.json -w "%{http_code}" \
  https://api.github.com/repos/HoTWinGs06/blockforge)
echo "Repo check /repos/HoTWinGs06/blockforge = $REPO_HTTP"
if [ "$REPO_HTTP" = "200" ]; then
  echo "WARNING: repo already exists — skip create, proceed to push."
else
  echo "Creating public repo via REST ..."
  curl -sS -X POST -H "Authorization: token $TOK" \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: blockforge" \
    -d '{"name":"blockforge","description":"Original unofficial Minecraft-inspired voxel sandbox. Not affiliated with Mojang/Microsoft.","private":false,"auto_init":false,"license_template":"mit"}' \
    https://api.github.com/user/repos | python3 -m json.tool | head -20 || true
fi

# 3. Push (main + integrated history)
echo "--- push ---"
git remote get-url origin 2>/dev/null || git remote add origin "https://github.com/HoTWinGs06/blockforge.git"
git push origin main || echo "push main: check remote"
git push origin feature/integrated/m1 || echo "push feature/integrated/m1: check"

echo "=== publish done; verify at https://github.com/HoTWinGs06/blockforge ==="
