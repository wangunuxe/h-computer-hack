export function shouldShowcase({ pathname, search, userAgent, coarsePointer }: {
  pathname: string; search: string; userAgent: string; coarsePointer: boolean;
}): boolean {
  return pathname === '/' && new URLSearchParams(search).get('client') !== 'phone'
    && !coarsePointer && !/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
