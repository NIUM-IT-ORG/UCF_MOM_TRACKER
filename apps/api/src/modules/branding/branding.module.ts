import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';

/** No providers: the crests are read and cached by common/print/emblem.ts. */
@Module({ controllers: [BrandingController] })
export class BrandingModule {}
