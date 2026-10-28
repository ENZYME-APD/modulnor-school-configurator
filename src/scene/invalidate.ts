// On-demand rendering: the scene only re-renders when something calls
// invalidate(). Kept dependency-free so any module can import it.

let needsRender = true;

/** Request a new frame. Cheap to call many times per frame. */
export function invalidate(): void {
  needsRender = true;
}

/** Returns true (once) if a render was requested since the last call. */
export function consumeInvalidation(): boolean {
  const r = needsRender;
  needsRender = false;
  return r;
}
