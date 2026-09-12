import { Module } from '@nestjs/common';
import { MastersController } from './masters.controller.js';
import { MastersService } from './masters.service.js';

@Module({ controllers: [MastersController], providers: [MastersService] })
export class MastersModule {}
