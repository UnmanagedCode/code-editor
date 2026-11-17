import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOSTILE_NAME = '<img src=x onerror=alert(1)>.txt';

export const mkTmp = (t, prefix = 'ce-') => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const write = (root, rel, data) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' });

/**
 * A git work tree with: .gitignore (build/, *.log, ignored.txt), src/main.ts, src/lib/util.ts, README.md, notes.txt,
 * a tracked file matching an ignore pattern (tracked.log), ignored files, a binary file, CRLF and BOM files, and the
 * hostile-named file. Returns {root, outside: {dir, file}} — `outside` is a sibling temp dir for symlink targets.
 */
export function makeTree(t, { symlinks = false, git: useGit = true } = {}) {
  const base = mkTmp(t);
  const root = path.join(base, 'app');
  fs.mkdirSync(root);
  write(root, '.gitignore', 'build/\n*.log\nignored.txt\n');
  write(root, 'README.md', '# App\nhello world\n');
  write(root, 'notes.txt', 'alpha\nbeta needle\ngamma\n');
  write(root, 'src/main.ts', 'export const answer = 42;\n// needle here\n');
  write(root, 'src/lib/util.ts', 'export const util = () => "needle";\n');
  write(root, 'tracked.log', 'tracked but matches *.log\n');
  write(root, 'ignored.txt', 'needle in ignored file\n');
  write(root, 'build/out.js', 'needle in build\n');
  write(root, 'debug.log', 'needle in log\n');
  write(root, 'crlf.txt', 'one\r\ntwo\r\n');
  write(root, 'bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom text\n')]));
  write(root, 'bin.dat', Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]));
  write(root, 'latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  write(root, HOSTILE_NAME, 'hostile name file\n');
  write(root, 'empty-dir/.keep', '');
  const outsideDir = path.join(base, 'outside');
  fs.mkdirSync(outsideDir);
  write(outsideDir, 'secret.txt', 'outside secret\n');
  const outsideFile = path.join(base, 'outside-file.txt');
  fs.writeFileSync(outsideFile, 'outside file\n');
  if (useGit) {
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'add', '-f', 'tracked.log');
    git(root, 'commit', '-q', '-m', 'init');
  }
  if (symlinks) {
    // A nested repository (a vendored checkout): its .git must be as off-limits as the root's.
    write(root, 'vendor/foo/.git/config', '[core]\n\trepositoryformatversion = 0\n');
    write(root, 'vendor/foo/.git/HEAD', 'ref: refs/heads/main\n');
    write(root, 'vendor/foo/.git/hooks/pre-commit', '#!/bin/sh\n');
    write(root, 'vendor/foo/lib.c', 'int x;\n');
    fs.symlinkSync('vendor/foo/.git', path.join(root, 'leak'));
    fs.symlinkSync('vendor/foo', path.join(root, 'leakdir'));
    fs.symlinkSync(outsideDir, path.join(root, 'out'));
    fs.symlinkSync(outsideFile, path.join(root, 'outfile'));
    if (useGit) fs.symlinkSync('.git', path.join(root, 'gitlink'));
    fs.symlinkSync('.', path.join(root, 'loop'));
    fs.symlinkSync('nope', path.join(root, 'broken'));
    fs.symlinkSync('src', path.join(root, 'inner'));
    fs.symlinkSync('README.md', path.join(root, 'readme-link'));
  }
  return { root, base, outside: { dir: outsideDir, file: outsideFile } };
}

/** A tree of `files` ({rel: content}) with no git. */
export function makePlainTree(t, files = {}) {
  const base = mkTmp(t);
  const root = path.join(base, 'plain');
  fs.mkdirSync(root);
  for (const [rel, data] of Object.entries(files)) write(root, rel, data);
  return { root, base };
}

export const readDisk = (root, rel) => fs.readFileSync(path.join(root, rel));
