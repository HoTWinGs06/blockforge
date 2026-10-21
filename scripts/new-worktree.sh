#!/usr/bin/env bash
# Create a BlockForge worktree that is ready to work in, fast.
#
# The problem this solves: every git worktree needs its own node_modules, and
# `npm ci` costs 6-30 s and ~150 MB per worktree. With seven worktrees that
# is over a gigabyte of duplicated dependencies and a slow start every time
# an agent starts a task.
#
# This creates the worktree, links the canonical repo's node_modules into it,
# and verifies the toolchain resolves. If you need to ADD a dependency, run
# `npm install <pkg>` inside the worktree - that will replace the link with a
# real tree, which is correct but slower. Do not run `npm ci` in a linked
# worktree: it would delete the shared tree.
#
#   scripts/new-worktree.sh <agent-name> [branch-suffix]
#
# Example:
#   scripts/new-worktree.sh engine m1
#   -> ~/workspace/worktrees/bf-engine on branch feature/engine/m1

set -euo pipefail

AGENT="${1:?usage: new-worktree.sh <agent-name> [branch-suffix]}"
SUFFIX="${2:-m1}"
BRANCH="feature/${AGENT}/${SUFFIX}"
WT="$HOME/workspace/worktrees/bf-${AGENT}"
REPO="$HOME/workspace/blockforge"

export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"

if [ ! -d "$REPO" ]; then
  echo "canonical repo not found at $REPO" >&2
  exit 1
fi

cd "$REPO"
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git worktree add "$WT" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WT" main
fi

cd "$WT"
if [ ! -e node_modules ]; then
  ln -s "$REPO/node_modules" node_modules
  echo "linked node_modules from the canonical repo"
else
  echo "node_modules already present - left alone"
fi

# A linked tree has no .bin on Windows-style installs, but on Linux npm resolves
# binaries from the symlinked node_modules/.bin, so verify the toolchain works.
node -v
npx --no-install tsc --version >/dev/null && echo "toolchain OK"
echo "worktree ready: $WT on $BRANCH"
