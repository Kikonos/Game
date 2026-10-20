#!/bin/bash
# Commits any work in the three track worktrees and pushes the wip/* backup branches.
set -u
for d in art mobile balance acmi brand; do
  cd /home/user/wt/$d 2>/dev/null || continue
  rm -f scripts/*-tmp.ts
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit -q -m "WIP checkpoint ($d) $(date -u +%FT%H:%MZ) [skip ci]" -m "$(printf 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01RF9bn7dpReK5tAwKUQRQ8G')" && echo "$d: committed"
  else
    echo "$d: clean"
  fi
done
cd /home/user/wt/notes && git add -A && git commit -q -m "Handover notes $(date -u +%FT%H:%MZ)" 2>/dev/null
cd /home/user/Game && git push -q origin wip/art wip/mobile wip/balance wip/handover acmi brand 2>wip/handover acmi 2>&11 | tail -3
git ls-remote --heads origin | sed 's/refs\/heads\///'
