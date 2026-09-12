import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  agendaItemDto,
  attendanceDto,
  cancelDto,
  carryDto,
  createMeetingDto,
  documentInput,
  inviteesDto,
  rescheduleDto,
  rsvpDto,
  updateMeetingDto,
} from '@mom/shared';
import { MeetingsService } from './meetings.service.js';
import { AgendaService } from './agenda.service.js';
import { AttendanceService } from './attendance.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CapabilityGuard } from '../auth/capability.guard.js';
import { RequireCapability } from '../auth/require-capability.decorator.js';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { Audited } from '../../common/audit.interceptor.js';
import { AppError } from '../../common/app-error.js';

const walkInDto = z.object({ userId: z.string().min(1) }).strict();

/**
 * One controller for the meeting aggregate.
 *
 * Agenda, invitees and attendance are separate services because they are
 * separate rules, but they are not separate resources: everything here is
 * addressed through the meeting that owns it, so the scope check happens once,
 * in `mustSee`, and cannot be reached around.
 */
@Controller('meetings')
@UseGuards(JwtAuthGuard, CapabilityGuard)
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly agenda: AgendaService,
    private readonly attendance: AttendanceService,
    private readonly documents: DocumentsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('category') category?: string,
    @Query('projectId') projectId?: string,
    @Query('stage') stage?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.meetings.list(user, { type, category, projectId, stage, q, from, to });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetings.get(user, id);
  }

  /**
   * One route, two journeys. The capability required depends on which: a
   * designation may be allowed to call an instant meeting without being allowed
   * to schedule one, and the guard cannot know which until the body is read.
   */
  @Post()
  @Audited({ objectType: 'MEETING', event: 'MEETING_CREATED' })
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto = createMeetingDto.parse(body);
    const needed = dto.type === 'INSTANT' ? 'plan_instant' : 'plan_scheduled';
    if (!user.caps.includes(needed)) throw AppError.forbidden(needed);
    return this.meetings.create(user, dto);
  }

  @Patch(':id')
  @Audited({ objectType: 'MEETING', event: 'MEETING_UPDATED' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    if (!user.caps.includes('plan_scheduled') && !user.caps.includes('plan_instant')) {
      throw AppError.forbidden('plan_scheduled');
    }
    return this.meetings.update(user, id, updateMeetingDto.parse(body));
  }

  @Post(':id/launch')
  @RequireCapability('plan_instant')
  @Audited({ objectType: 'MEETING', event: 'MEETING_LAUNCHED' })
  launch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetings.launch(user, id);
  }

  @Post(':id/end')
  @Audited({ objectType: 'MEETING', event: 'MEETING_HELD' })
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!user.caps.includes('plan_instant') && !user.caps.includes('confirm_meeting')) {
      throw AppError.forbidden('confirm_meeting');
    }
    return this.meetings.end(user, id);
  }

  @Post(':id/confirm')
  @RequireCapability('confirm_meeting')
  @Audited({ objectType: 'MEETING', event: 'MEETING_CONFIRMED' })
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.meetings.confirm(user, id);
  }

  @Post(':id/reschedule')
  @RequireCapability('confirm_meeting')
  reschedule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.meetings.reschedule(user, id, rescheduleDto.parse(body));
  }

  @Post(':id/cancel')
  @RequireCapability('confirm_meeting')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.meetings.cancel(user, id, cancelDto.parse(body));
  }

  // ── agenda ───────────────────────────────────────────────────────────

  @Get(':id/agenda-items')
  listAgenda(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agenda.list(user, id);
  }

  @Post(':id/agenda-items')
  @RequireCapability('add_agenda')
  @Audited({ objectType: 'AGENDA_ITEM', event: 'AGENDA_ITEM_ADDED' })
  addAgenda(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.agenda.add(user, id, agendaItemDto.parse(body));
  }

  @Patch(':id/agenda-items/:aid')
  @RequireCapability('add_agenda')
  updateAgenda(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Body() body: unknown,
  ) {
    return this.agenda.update(user, id, aid, agendaItemDto.parse(body));
  }

  @Delete(':id/agenda-items/:aid')
  @RequireCapability('add_agenda')
  @Audited({ objectType: 'AGENDA_ITEM', event: 'AGENDA_ITEM_REMOVED' })
  removeAgenda(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('aid') aid: string) {
    return this.agenda.remove(user, id, aid);
  }

  @Post(':id/agenda-items/:aid/defer')
  @RequireCapability('add_agenda')
  deferAgenda(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('aid') aid: string) {
    return this.agenda.defer(user, id, aid);
  }

  @Get(':id/carry-candidates')
  @RequireCapability('add_agenda')
  carryCandidates(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.agenda.carryCandidates(user, id);
  }

  @Post(':id/carry')
  @RequireCapability('add_agenda')
  @Audited({ objectType: 'MEETING', event: 'ITEMS_CARRIED_FORWARD' })
  carry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.agenda.carry(user, id, carryDto.parse(body));
  }

  // ── invitees, RSVP, attendance ───────────────────────────────────────

  @Get(':id/invitees')
  listInvitees(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.attendance.list(user, id);
  }

  @Put(':id/invitees')
  @Audited({ objectType: 'MEETING', event: 'INVITEES_CHANGED' })
  setInvitees(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    if (!user.caps.includes('plan_scheduled') && !user.caps.includes('plan_instant')) {
      throw AppError.forbidden('plan_scheduled');
    }
    return this.attendance.setInvitees(user, id, inviteesDto.parse(body));
  }

  /** Any invitee may answer — for themselves. No capability, and no userId in the body. */
  @Put(':id/rsvp')
  rsvp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.attendance.rsvp(user, id, rsvpDto.parse(body));
  }

  @Put(':id/attendance')
  @RequireCapability('mark_attendance')
  @Audited({ objectType: 'MEETING', event: 'ATTENDANCE_RECORDED' })
  setAttendance(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.attendance.setAttendance(user, id, attendanceDto.parse(body));
  }

  @Post(':id/attendance/walk-in')
  @RequireCapability('mark_attendance')
  @Audited({ objectType: 'MEETING', event: 'WALK_IN_ADDED' })
  walkIn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.attendance.walkIn(user, id, walkInDto.parse(body).userId);
  }

  // ── documents ────────────────────────────────────────────────────────

  @Get(':id/documents')
  listDocuments(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.listForMeeting(user, id);
  }

  @Post(':id/documents')
  @RequireCapability('manage_project_docs')
  @Audited({ objectType: 'DOCUMENT', event: 'DOCUMENT_ADDED' })
  addDocument(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.addToMeeting(user, id, documentInput.parse(body));
  }
}
