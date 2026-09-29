import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { cdmaLogo, emblem } from '../../common/print/emblem.js';
import { Public } from '../auth/public.decorator.js';
import { RawResponse } from '../../common/interceptors/envelope.interceptor.js';

/**
 * The two crests, for the screen.
 *
 * They were already loaded for the printed documents — see
 * `common/print/emblem.ts`, which reads `var/branding/` in preference to the
 * tracked `assets/branding/` so an office can drop its own file in without
 * touching the build. Serving those same bytes here, rather than copying the
 * PNGs into the web app, means the sign-in page and the minutes can never
 * show different crests: replace the file once and both follow.
 *
 * Public, because the first place a crest belongs is the sign-in page and
 * nobody is signed in there. A state emblem is not a secret.
 */
@Controller('branding')
export class BrandingController {
  @Public()
  @Get(':name')
  @RawResponse()
  @Header('cache-control', 'public, max-age=86400')
  @Header('x-content-type-options', 'nosniff')
  get(@Param('name') name: string, @Res() res: Response): void {
    const uri = name === 'emblem' ? emblem() : name === 'cdma' ? cdmaLogo() : null;

    /*
     * 404 rather than a placeholder. The loader is deliberate that a missing
     * file prints nothing rather than inventing a crest; the screen follows
     * the same rule, hides the image, and lets the wording stand on its own.
     */
    if (!uri) {
      res.status(404).end();
      return;
    }

    // `data:image/png;base64,AAAA…` — the loader returns a data URI because
    // that is what an emailed document needs. Here it is split back apart.
    const comma = uri.indexOf(',');
    const meta = uri.slice(0, comma);
    const b64 = uri.slice(comma + 1);
    res.setHeader('content-type', meta.slice('data:'.length).replace(';base64', ''));
    res.send(Buffer.from(b64, 'base64'));
  }
}
