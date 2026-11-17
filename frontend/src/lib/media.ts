import { useMediaQuery, WIDE_QUERY } from './useMediaQuery';

/** Below Tailwind's `md`: the phone layout (sheets instead of a sidebar). */
export const useNarrow = (): boolean => !useMediaQuery(WIDE_QUERY);

