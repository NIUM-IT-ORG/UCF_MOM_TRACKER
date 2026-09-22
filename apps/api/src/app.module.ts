import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { loadEnv } from './config/env.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { MastersModule } from './modules/masters/masters.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { MeetingsModule } from './modules/meetings/meetings.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { ItemsModule } from './modules/items/items.module.js';
import { MomModule } from './modules/mom/mom.module.js';
import { ShareModule } from './modules/share/share.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor.js';
import { AuditInterceptor } from './common/audit.interceptor.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Validated once, at boot. A bad environment stops the process here
      // rather than surfacing as a null three layers down at request time.
      validate: (raw) => loadEnv(raw as NodeJS.ProcessEnv),
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    AccessModule,
    MastersModule,
    FilesModule,
    ProjectsModule,
    NotificationsModule,
    MeetingsModule,
    ItemsModule,
    DashboardModule,
    ReportsModule,
    MomModule,
    ShareModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
  ],
})
export class AppModule {}
