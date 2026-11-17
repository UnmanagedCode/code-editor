/** Project-relative POSIX path helpers. '' is the root. */

export const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);
export const parent = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const leaf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** True when `path` is `ancestor` or lies beneath it ('' contains everything). */
export const isUnder = (path: string, ancestor: string): boolean => ancestor === '' || path === ancestor || path.startsWith(`${ancestor}/`);

/** Where `path` lands after `from` is renamed to `to`: exact or beneath a renamed folder; otherwise unchanged. */
export const retarget = (path: string, from: string, to: string): string => {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
};

/** Why `name` cannot be a single file or folder name, or null when it can. */
export function leafNameError(name: string): string | null {
  if (name.trim() === '') return 'Enter a name.';
  if (name.includes('/')) return 'A name cannot contain "/".';
  if (name === '.' || name === '..') return `"${name}" is not a valid name.`;
  if (name === '.git') return '".git" cannot be used.';
  if (name.includes('\0')) return 'A name cannot contain NUL.';
  return null;
}
