import { Body, Controller, Get, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { reserveFileDto } from '@mom/shared';
import { FilesService } from './files.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Step one. Returns the id and where to send the bytes. */
  @Post()
  reserve(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    return this.files.reserve(reserveFileDto.parse(body), user.id);
  }

  /**
   * Step two. The raw body is the file, parsed by the raw middleware
   * registered for this path in main.ts - not by the JSON parser, which would
   * choke on a PDF.
   */
  @Put(':id/content')
  upload(@Param('id') id: string, @Req() req: Request, @CurrentUser() user: AuthUser) {
    const body = req.body as unknown;
    const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    return this.files.storeContent(id, bytes, user.id);
  }

  @Get(':id/content')
  async download(@Param('id') id: string, @Res() res: Response) {
    const file = await this.files.read(id);
    res.setHeader('content-type', file.mimeType);
    // `attachment` on purpose: an HTML or SVG upload rendered inline would run
    // in this origin, which is how a file store becomes a cross-site scripting
    // hole. Nothing served from here is ever displayed in place.
    res.setHeader(
      'content-disposition',
      `attachment; filename="${file.fileName.replace(/["\\]/g, '')}"`,
    );
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(file.bytes);
  }
}
