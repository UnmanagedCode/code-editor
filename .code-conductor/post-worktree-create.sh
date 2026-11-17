#!/usr/bin/env bash
# Link the main checkout's out-of-tree state into this worktree: the project
# wiki (.wiki) and every node_modules directory.
#
# Run by code-conductor after creating a worktree, with cwd in the new
# worktree. CC_PARENT_PATH is the main checkout's absolute path.

# Project wiki (out-of-tree): exclude it, then link the main checkout's copy.
# --git-path finds the exclude file every worktree shares; '/.wiki' has no
# trailing slash so it also matches the symlink.
(
    cd "${CC_WORKTREE_PATH:?CC_WORKTREE_PATH is unset}" || exit 1
    WIKI_EXCLUDE="$(git rev-parse --git-path info/exclude)"
    if ! grep -qxF '/.wiki' "$WIKI_EXCLUDE" 2>/dev/null; then
        mkdir -p "$(dirname "$WIKI_EXCLUDE")"
        if [ -s "$WIKI_EXCLUDE" ] && [ -n "$(tail -c1 "$WIKI_EXCLUDE")" ]; then echo >> "$WIKI_EXCLUDE"; fi
        echo '/.wiki' >> "$WIKI_EXCLUDE"
    fi
    WIKI_PARENT="${CC_PARENT_PATH:?CC_PARENT_PATH is unset}/.wiki"
    if [ ! -e .wiki ] && [ ! -L .wiki ]; then
        if [ -d "$WIKI_PARENT" ]; then
            ln -s "$WIKI_PARENT" .wiki
        else
            echo "[post-worktree-create] WARNING: ${WIKI_PARENT} not found; no .wiki symlink." >&2
        fi
    fi
)

# node_modules: symlink each one that exists in the main checkout. find prunes
# .git/.wiki/.worktrees so they are never searched, and prunes each node_modules
# so nested copies inside it are not picked up.
if [ -z "${CC_PARENT_PATH:-}" ]; then
    echo "[post-worktree-create] WARNING: CC_PARENT_PATH unset; skipping node_modules symlinks." >&2
    exit 0
fi
while IFS= read -r dir; do
    rel="${dir#"${CC_PARENT_PATH}"/}"
    if [ -e "$rel" ] || [ -L "$rel" ]; then
        echo "[post-worktree-create] $rel already exists - skipping symlink."
        continue
    fi
    mkdir -p "$(dirname "$rel")"
    ln -s "${CC_PARENT_PATH}/${rel}" "$rel"
done < <(find "${CC_PARENT_PATH}" \( -name .git -o -name .wiki -o -name .worktrees \) -prune \
    -o -type d -name node_modules -prune -print)
