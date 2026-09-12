import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';

export const RAW_RESPONSE = 'ucf:raw-response';

/**
 * Marks a route whose body is the response, not something to wrap.
 *
 * The MoM document is an HTML page; wrapping it in `{ data: "<!doctype…" }`
 * would make it a JSON string that no browser will render. An explicit
 * decorator rather than sniffing the content-type, because "this route is not
 * JSON" is a decision the route should state, not one an interceptor infers.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/**
 * Wraps every successful response in `{ data }`.
 *
 * A paged handler returns `{ data, meta }` itself; that shape is passed through
 * untouched so it does not end up as `{ data: { data, meta } }`. Anything else
 * — including `null` — is wrapped, so a client never has to branch on whether
 * the envelope is present.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.get<boolean | undefined>(RAW_RESPONSE, ctx.getHandler())) {
      return next.handle();
    }
    return next.handle().pipe(
      map((body: unknown) => {
        if (isPaged(body)) return body;
        return { data: body ?? null };
      }),
    );
  }
}

function isPaged(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    'meta' in body &&
    Array.isArray((body as { data: unknown }).data)
  );
}
