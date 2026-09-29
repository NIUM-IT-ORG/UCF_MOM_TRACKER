'use client';

import { useState } from 'react';

/**
 * A state crest, served from the API.
 *
 * The same bytes the printed documents carry — `common/print/emblem.ts` reads
 * `var/branding/` in preference to the tracked `assets/branding/`, so an
 * office that drops its own file in gets it on the screen and on the minutes
 * at once. Copying the PNGs into the web app would have let the two drift.
 *
 * Absent is a legal state. The loader is deliberate that a missing file
 * prints nothing rather than inventing a crest, and this follows it: on a 404
 * the image removes itself and the wording beside it stands on its own. A
 * broken-image icon on a government sign-in page is worse than no crest.
 */
export function Crest({
  name,
  size,
  alt,
  className = '',
}: {
  name: 'emblem' | 'cdma';
  size: number;
  alt: string;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;

  return (
    // A plain <img>, not next/image: this is one small asset served by the
    // API, and next/image would want a loader and a known intrinsic size for
    // a file that may not exist at all.
    <img
      src={`/api/v1/branding/${name}`}
      alt={alt}
      height={size}
      style={{ height: size, width: 'auto' }}
      className={className}
      onError={() => setMissing(true)}
    />
  );
}
