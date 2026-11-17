import { useMediaQuery, WIDE_QUERY } from './useMediaQuery';

/** Below Tailwind's `md`: the phone layout (sheets instead of a sidebar). */
export const useNarrow = (): boolean => !useMediaQuery(WIDE_QUERY);

/** A coarse primary-or-any pointer: touch devices, where per-row menus are always visible. */
export const useCoarsePointer = (): boolean => useMediaQuery('(any-pointer: coarse)');
