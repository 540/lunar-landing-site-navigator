#!/usr/bin/env bash
# Merges the software-factory PRs of everyone on the team, without spending CI minutes.
# A LaunchAgent (see install.sh) runs it every two minutes on one machine. Each run:
#   1. lists the open PRs into main whose branch is a runner branch, feat/<issue>-<slug>, and whose
#      issue carries the runner label (agent-lunar), whoever opened them;
#   2. skips a PR whose last commit is only a few minutes old (the runner may still be pushing), that
#      the runner's review has not approved at its current head (the "# PR Analysis" comment with
#      "Analyzed head: <sha>" and "Result: APPROVED"), or that GitHub does not report as MERGEABLE
#      (conflicts, or still computing: the next run retries);
#   3. marks it ready, merges it with rebase (squash when the branch cannot be rebased), deletes the remote branch and closes the issue
#      (the runner's PRs do not say "Closes #N", and a blocked issue waits for its blocker to close);
#   4. after a merge, pulls main into this checkout (only when it is on main and clean) and runs
#      release/auto.sh, which publishes a release when the new commit changes the product.
# The runner already runs `npm test` before it opens a PR, so this script does not run the tests again.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${AUTOMERGE_REPO:-540/lunar-landing-site-navigator}"
PREFIX="${AUTOMERGE_BRANCH_PREFIX:-feat/}"
MIN_AGE_MIN="${AUTOMERGE_MIN_AGE_MIN:-5}"
LABEL="${AUTOMERGE_LABEL:-agent-lunar}"
AUTHOR="${AUTOMERGE_AUTHOR:-}"   # empty: any author
REQUIRE_REVIEW="${AUTOMERGE_REQUIRE_REVIEW:-1}"
DRY_RUN="${AUTOMERGE_DRY_RUN:-0}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

gh auth status >/dev/null 2>&1 || { log "gh has no login: run 'gh auth login'"; exit 1; }

# gh pr merge --delete-branch also touches the local branch of the current repo; run it from
# outside the checkout so it only deletes the remote branch (the runner cleans its own worktree).
cd "$HOME" || exit 1

PRS="$(gh pr list -R "$REPO" ${AUTHOR:+--author "$AUTHOR"} --base main --state open \
  --json number,headRefName,headRefOid,isDraft,mergeable,commits \
  --jq ".[] | select(.headRefName | test(\"^$PREFIX[0-9]+-\"))
        | \"\(.number) \(.headRefName | ltrimstr(\"$PREFIX\") | split(\"-\")[0]) \(.headRefOid) \(.isDraft) \(.mergeable) \((now - (.commits[-1].committedDate | fromdateiso8601)) / 60 | floor)\"")" || {
  log "could not list the PRs of $REPO"; exit 1; }

merged=0
# Prints the verdict of the runner's latest review of PR $1 when it analysed head $2, else nothing.
review_verdict() {
  gh api "repos/$REPO/issues/$1/comments?per_page=100" --paginate \
    --jq '[.[] | select(.body | startswith("# PR Analysis"))] | last | .body // ""' 2>/dev/null |
    awk -v head="$2" '
      /Analyzed head:/ { for (i = 1; i <= NF; i++) if ($i ~ /^[0-9a-f]{7,40}$/ && index(head, $i) == 1) ok = 1 }
      ok && /Result: APPROVED/ { print "APPROVED"; exit }
      ok && /Result: CHANGES REQUESTED/ { print "CHANGES"; exit }'
}

while read -r number issue head draft mergeable age; do
  [ -z "${number:-}" ] && continue
  gh issue view "$issue" -R "$REPO" --json labels --jq '.labels[].name' 2>/dev/null | grep -qx "$LABEL" || continue
  if [ "$age" -lt "$MIN_AGE_MIN" ]; then log "#$number: last commit ${age} min ago, waits"; continue; fi
  if [ "$REQUIRE_REVIEW" = 1 ]; then
    verdict="$(review_verdict "$number" "$head")"
    if [ "$verdict" != APPROVED ]; then log "#$number: review of ${head:0:7} ${verdict:-pending}, waits"; continue; fi
  fi
  if [ "$mergeable" != MERGEABLE ]; then log "#$number: $mergeable, stays open"; continue; fi
  if [ "$DRY_RUN" = 1 ]; then log "#$number: would merge (dry run)"; continue; fi
  [ "$draft" = true ] && gh pr ready "$number" -R "$REPO" >/dev/null
  # A runner branch that merged main in cannot be rebased: squash keeps main linear all the same.
  if gh pr merge "$number" -R "$REPO" --rebase --delete-branch >/dev/null 2>&1 ||
     gh pr merge "$number" -R "$REPO" --squash --delete-branch >/dev/null; then
    log "#$number: merged"; merged=1
    gh issue close "$issue" -R "$REPO" -c "Fusionada en #$number por la fusión automática (automerge/)." >/dev/null 2>&1 || true
  else
    log "#$number: merge failed, stays open"
  fi
done <<< "$PRS"

[ "$merged" = 1 ] || exit 0

cd "$REPO_DIR" || exit 1
if [ "$(git rev-parse --abbrev-ref HEAD)" != main ] || [ -n "$(git status --porcelain)" ]; then
  log "checkout not on a clean main: pull it by hand"
  exit 0
fi
if git pull --ff-only --quiet; then
  log "main pulled to $(git rev-parse --short HEAD)"
  [ "$(git config core.hooksPath)" = .githooks ] && "$REPO_DIR/release/auto.sh"
else
  log "git pull --ff-only failed: pull main by hand"
fi
