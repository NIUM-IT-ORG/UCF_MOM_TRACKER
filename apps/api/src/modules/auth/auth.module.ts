import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { TokensService } from './tokens.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CapabilityGuard } from './capability.guard.js';

/**
 * Global, because JwtAuthGuard and CapabilityGuard are used by every other
 * module. Exporting them here keeps each feature module free of auth wiring.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService, JwtAuthGuard, CapabilityGuard],
  exports: [AuthService, TokensService, JwtAuthGuard, CapabilityGuard],
})
export class AuthModule {}
