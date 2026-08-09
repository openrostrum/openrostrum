#!/usr/bin/env bash
# Append-only history guards (docs/process.md → Git). Wired in lefthook.yml.
set -euo pipefail

mode="${1:?usage: guard-append-only.sh amend|rebase|force-push [hook args]}"

case "$mode" in
	amend)
		# prepare-commit-msg receives (source, sha) = ("commit", "HEAD") only on --amend.
		if [ "${2:-}" = "commit" ] && [ "${3:-}" = "HEAD" ]; then
			echo "✖ git commit --amend is blocked: history is append-only — make a NEW commit." >&2
			echo "  Fixup noise vanishes at squash-merge. See docs/process.md → Git." >&2
			exit 1
		fi
		;;
	rebase)
		echo "✖ git rebase is blocked: history is append-only — merge main into your branch instead (git merge main)." >&2
		echo "  See docs/process.md → Git." >&2
		exit 1
		;;
	force-push)
		zero=0000000000000000000000000000000000000000
		# pre-push stdin lines: <local ref> <local sha> <remote ref> <remote sha>
		while read -r _lref lsha rref rsha; do
			[ "$rsha" = "$zero" ] && continue # new branch
			[ "$lsha" = "$zero" ] && continue # branch deletion
			if ! git merge-base --is-ancestor "$rsha" "$lsha" 2>/dev/null; then
				echo "✖ push to $rref blocked: the remote tip is not an ancestor of what you're pushing." >&2
				echo "  History is append-only — never force-push: git fetch, merge, and push forward." >&2
				echo "  See docs/process.md → Git." >&2
				exit 1
			fi
		done
		;;
esac
