import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'ucf:isPublic';

/** Marks a route as reachable without signing in. Used sparingly, and only here. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
