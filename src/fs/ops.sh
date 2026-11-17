# code-editor target-side helper. Run as: sh -c "$(cat ops.sh)" code-editor <op> [args...]  (cwd = the project's tree, LC_ALL=C).
# Every path argument is './<rel>' (or '.'); every utility call puts '--' before path operands. Exit codes: src/fs/script.js.
set -u

E_NOTFOUND=65 E_OUTSIDE=66 E_EXISTS=67 E_CONFLICT=68 E_NOTDIR=69 E_NOTFILE=70 E_REFUSED=71 E_DENIED=72 E_SEARCHBAD=73 E_NOSEARCH=74 E_NOTOOL=75

op=${1:-}
[ -n "$op" ] || exit 64
shift

need() { command -v "$1" >/dev/null 2>&1 || { printf '%s' "$1" >&2; exit "$E_NOTOOL"; }; }

need realpath
ROOT=$(pwd -P) || exit 64
[ "$ROOT" != / ] || exit "$E_REFUSED"

TMP=
FILE_TMP=
cleanup() {
  [ -z "$TMP" ] || rm -rf -- "$TMP"
  [ -z "$FILE_TMP" ] || rm -f -- "$FILE_TMP"
}
trap cleanup EXIT

# 0 = inside the root with no .git component; 1 = outside the root; 2 = .git (the root's or a nested repository's).
# Every component of the RESOLVED path is checked, in any letter case (case-insensitive file systems), and each ancestor is also
# compared by identity with the root's .git.
allowed() {
  case $1 in
    "$ROOT") return 0 ;;
    "$ROOT"/*) ;;
    *) return 1 ;;
  esac
  case /${1#"$ROOT"/}/ in */[.][gG][iI][tT]/*) return 2 ;; esac
  _p=$1
  while [ "$_p" != "$ROOT" ] && [ -n "$_p" ]; do
    if [ "$_p" -ef "$ROOT/.git" ]; then return 2; fi
    _p=${_p%/*}
  done
  return 0
}

check_allowed() {
  allowed "$1"
  case $? in
    0) ;;
    1) exit "$E_OUTSIDE" ;;
    *) exit "$E_REFUSED" ;;
  esac
}

# Existing path $1: sets REAL to its fully resolved path, confined to the root.
resolve() {
  [ -e "$1" ] || [ -L "$1" ] || exit "$E_NOTFOUND"
  REAL=$(realpath -e -- "$1" 2>/dev/null) || exit "$E_NOTFOUND"
  check_allowed "$REAL"
}

# Entry path $1: resolves its parent (confined) into PDIR and keeps the leaf literal in LEAF.
resolve_parent() {
  case $1 in
    */*) _parent=${1%/*} ;;
    *) _parent=. ;;
  esac
  LEAF=${1##*/}
  case $LEAF in '' | . | .. | [.][gG][iI][tT]) exit "$E_REFUSED" ;; esac
  [ -e "$_parent" ] || exit "$E_NOTFOUND"
  PDIR=$(realpath -e -- "$_parent" 2>/dev/null) || exit "$E_NOTFOUND"
  check_allowed "$PDIR"
  [ -d "$PDIR" ] || exit "$E_NOTDIR"
}

exists() { [ -e "$1" ] || [ -L "$1" ]; }

case $op in
  list)
    [ $# -ge 2 ] || exit 64
    resolve "$1"
    [ -d "$REAL" ] || exit "$E_NOTDIR"
    [ -r "$REAL" ] || exit "$E_DENIED"
    max=$2
    TMP=$(mktemp -d) || exit 64
    case $REAL in "$ROOT") relprefix= ;; *) relprefix=${REAL#"$ROOT"/}/ ;; esac
    n=0
    : > "$TMP/names"
    for e in "$REAL"/* "$REAL"/.[!.]* "$REAL"/..?*; do
      exists "$e" || continue
      name=${e##*/}
      case $name in [.][gG][iI][tT]) continue ;; esac
      n=$((n + 1))
      if [ "$n" -gt "$max" ]; then
        printf '/truncated\0'
        break
      fi
      slash=
      if [ -L "$e" ]; then
        if t=$(realpath -e -- "$e" 2>/dev/null); then
          allowed "$t"
          case $? in
            0) if [ -d "$t" ]; then kind=l:d; elif [ -f "$t" ]; then kind=l:f; else kind=l:o; fi ;;
            1) kind=l:outside ;;
            *) kind=l:git ;;
          esac
        else
          kind=l:broken
        fi
      elif [ -d "$e" ]; then
        kind=d
        slash=/
      elif [ -f "$e" ]; then
        kind=f
      else
        kind=o
      fi
      printf '%s\0%s\0' "$kind" "$name"
      printf '%s\0' "$relprefix$name$slash" >> "$TMP/names"
    done
    if [ -s "$TMP/names" ]; then
      # Exit 1 = nothing ignored; 128 = not a repo (or a path beyond a symlink): treated as none ignored.
      git -c core.quotePath=false check-ignore -z --stdin < "$TMP/names" > "$TMP/ignored" 2>/dev/null
      if [ -s "$TMP/ignored" ]; then
        printf '/ignored\0'
        cat "$TMP/ignored"
      fi
    fi
    ;;

  read)
    [ $# -ge 2 ] || exit 64
    need stat
    resolve "$1"
    [ -f "$REAL" ] || exit "$E_NOTFILE"
    [ -r "$REAL" ] || exit "$E_DENIED"
    size=$(stat -c %s -- "$REAL") || exit 64
    printf '%s\n' "$size"
    head -c "$2" < "$REAL"
    ;;

  write)
    [ $# -ge 2 ] || exit 64
    need sha256sum
    need mktemp
    expected=$2
    if exists "$1"; then
      [ -e "$1" ] || exit "$E_NOTFOUND" # a dangling link
      resolve "$1"
      [ -f "$REAL" ] || exit "$E_NOTFILE"
      PDIR=${REAL%/*}
      have=1
      [ -w "$REAL" ] || exit "$E_DENIED"
    else
      resolve_parent "$1"
      REAL=$PDIR/$LEAF
      have=0
    fi
    [ -w "$PDIR" ] || exit "$E_DENIED"
    # Stage first (the slow part: it copies stdin), then compare and rename back to back, so the window in which another
    # writer can slip in is only the gap between the hash and the rename.
    FILE_TMP=$(mktemp "$PDIR/.code-editor-XXXXXX") || exit "$E_DENIED"
    cat > "$FILE_TMP" || exit 64
    if [ "$have" = 1 ]; then
      # A file deleted while staging is reported as a conflict below, so a missing reference is not an error here.
      if [ -e "$REAL" ]; then chmod --reference="$REAL" -- "$FILE_TMP" || exit 64; fi
    else
      chmod "$(printf '%03o' $((0666 & ~$(umask))))" -- "$FILE_TMP" || exit 64
    fi
    if exists "$REAL"; then
      if [ -f "$REAL" ] && [ ! -L "$REAL" ]; then current=$(sha256sum < "$REAL" | cut -d' ' -f1); else current=-; fi
    else
      current=-
    fi
    if [ "$current" != "$expected" ]; then
      printf '%s' "$current"
      exit "$E_CONFLICT"
    fi
    if [ "$have" = 1 ]; then
      mv -f -- "$FILE_TMP" "$REAL" || exit 64
    else
      # "Must not exist": a no-clobber rename. If the temp file is still here, the file appeared in the meantime.
      mv -n -T -- "$FILE_TMP" "$REAL" 2> /dev/null
      if [ -e "$FILE_TMP" ]; then
        if [ -f "$REAL" ] && [ ! -L "$REAL" ]; then current=$(sha256sum < "$REAL" | cut -d' ' -f1); else current=-; fi
        printf '%s' "$current"
        exit "$E_CONFLICT"
      fi
    fi
    FILE_TMP=
    ;;

  create)
    [ $# -ge 1 ] || exit 64
    resolve_parent "$1"
    f=$PDIR/$LEAF
    ! exists "$f" || exit "$E_EXISTS"
    set -C
    if ! { true > "$f"; } 2>/dev/null; then
      ! exists "$f" || exit "$E_EXISTS"
      exit "$E_DENIED"
    fi
    ;;

  mkdir)
    [ $# -ge 1 ] || exit 64
    resolve_parent "$1"
    f=$PDIR/$LEAF
    if ! mkdir -- "$f" 2>/dev/null; then
      ! exists "$f" || exit "$E_EXISTS"
      exit "$E_DENIED"
    fi
    ;;

  rename)
    [ $# -ge 2 ] || exit 64
    resolve_parent "$1"
    src=$PDIR/$LEAF
    exists "$src" || exit "$E_NOTFOUND"
    resolve_parent "$2"
    dst=$PDIR/$LEAF
    ! exists "$dst" || exit "$E_EXISTS"
    if [ ! -L "$src" ] && [ -d "$src" ]; then
      case $dst/ in "$src"/*) exit 64 ;; esac
    fi
    [ -w "$PDIR" ] || exit "$E_DENIED"
    mv -n -T -- "$src" "$dst" 2>/dev/null
    # mv -n skips silently when the destination appeared meanwhile: the source is then still here.
    if exists "$src"; then
      exists "$dst" && exit "$E_EXISTS"
      exit "$E_DENIED"
    fi
    ;;

  delete)
    [ $# -ge 1 ] || exit 64
    resolve_parent "$1"
    f=$PDIR/$LEAF
    exists "$f" || exit "$E_NOTFOUND"
    [ -w "$PDIR" ] || exit "$E_DENIED"
    # rm never follows a final-component link: a symlink is removed itself.
    rm -rf -- "$f" 2>/dev/null
    if exists "$f"; then exit "$E_DENIED"; fi
    ;;

  search)
    [ $# -ge 5 ] || exit 64
    mode=$1 sens=$2 max=$3 snip=$4 pat=$5
    TMP=$(mktemp -d) || exit 64
    if command -v rg >/dev/null 2>&1; then
      echo rg
      set -- --no-config --no-messages --null --line-number --no-heading --with-filename --color never --hidden -g '!.git' --max-columns "$snip" --max-columns-preview
      [ "$mode" != fixed ] || set -- "$@" -F
      if [ "$sens" = sensitive ]; then set -- "$@" -s; else set -- "$@" -i; fi
      { rg "$@" -e "$pat" -- . 2> "$TMP/err"; } | head -n $((max + 1))
    elif command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
      echo git
      set -- -n -z -I --untracked --exclude-standard --no-color
      if [ "$mode" = fixed ]; then set -- "$@" -F; else set -- "$@" -E; fi
      [ "$sens" = sensitive ] || set -- "$@" -i
      { git grep "$@" -e "$pat" 2> "$TMP/err"; } | cut -b "1-$((snip + 4200))" | head -n $((max + 1))
    else
      exit "$E_NOSEARCH"
    fi
    if [ -s "$TMP/err" ]; then
      head -c 500 "$TMP/err" >&2
      exit "$E_SEARCHBAD"
    fi
    ;;

  files)
    [ $# -ge 1 ] || exit 64
    max=$1
    if command -v rg >/dev/null 2>&1; then
      echo rg
      rg --no-config --files --hidden -g '!.git' --null . 2> /dev/null | head -z -n $((max + 1))
    elif command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
      # rg skips every file an ignore rule matches, tracked or not. git lists tracked ones regardless, so the tracked files
      # that match a rule are appended after a /ignored marker for the backend to subtract (as many extra lines are
      # requested as there are such files, so the cap still holds after the subtraction).
      TMP=$(mktemp -d) || exit 64
      git ls-files -z --cached --ignored --exclude-standard > "$TMP/ignored" 2> /dev/null
      n=$(tr -cd '\0' < "$TMP/ignored" | wc -c)
      echo git
      git ls-files -z --cached --others --exclude-standard 2> /dev/null | head -z -n $((max + 1 + n))
      printf '/ignored\0'
      cat "$TMP/ignored"
    else
      exit "$E_NOSEARCH"
    fi
    ;;

  *) exit 64 ;;
esac
