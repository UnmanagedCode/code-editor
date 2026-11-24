When you cite a code location to the user, write it as a markdown link, never inside backticks: `[<file>:<line>](http://cc.internal/#plugin/code-editor/?ccPath=<absolute path>&ccLine=<n>&ccEndLine=<m>)`, dropping `&ccEndLine=<m>` for a single line.
<!-- cc:skill Code Editor link details. Use before citing a path with any character other than letters, digits and /._-, a file in a worktree, or a path outside cc's projects. -->
# Code Editor links

## `ccPath`
- The absolute path of the file in the checkout whose text you cite: a worker's worktree path for code on its branch, the project's path for the main checkout.
- Keep `A–Z a–z 0–9 / . _ -` raw. Percent-encode every other character as its UTF-8 bytes: space `%20`, `#` `%23`, `+` `%2B`, `%` `%25`, `&` `%26`, `=` `%3D`, `?` `%3F`, `(` `%28`, `)` `%29`, `é` `%C3%A9`.

## Lines
- `ccLine` is the 1-based first line.
- Add `ccEndLine` only for more than one line: the last line, greater than `ccLine`.

## Link text
- `<path relative to the project or worktree root>:<line>`, or `:<first>-<last>` for a range.
- Backslash-escape every ASCII punctuation character in it except `/ . - :`, `\` included, and percent-encode control characters (a newline is `%0A`).

## Shape
- The query goes after `#plugin/code-editor/`. `http://cc.internal/?ccPath=…#plugin/code-editor/` is refused and shows as plain text.
- Host exactly `cc.internal`, path `/`.

## Paths outside cc's projects
- A path in no cc project or worktree opens nothing (Code Editor shows "No project contains <path>"). Write such a path as plain code instead of a link.
