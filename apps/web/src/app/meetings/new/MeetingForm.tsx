'use client';

import { useEffect, useState } from 'react';
import {
  MEETING_CATEGORY_LABEL,
  type MeetingCategory,
} from '@mom/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Field } from '@/components/ui';
import type { Person } from '@/lib/meetings';

export interface MeetingDraft {
  category: MeetingCategory;
  title: string;
  meetingDate: string;
  startTime: string;
  endTime: string;
  venue: string;
  vcLink: string;
  chairId: string;
  projectIds: string[];
}

export function emptyDraft(): MeetingDraft {
  const today = new Date();
  return {
    category: 'WEEKLY_PROGRESS_REVIEW',
    title: '',
    meetingDate: today.toISOString().slice(0, 10),
    startTime: '11:00',
    endTime: '12:30',
    venue: '',
    vcLink: '',
    chairId: '',
    projectIds: [],
  };
}

/**
 * Client-side mirror of `createMeetingDto`.
 *
 * Deliberately a mirror and not the authority: the same rules are enforced by
 * the DTO on the server, and deleting this function would change nothing about
 * what is accepted. It exists to save a round trip and to put the message next
 * to the field, which the server cannot do.
 */
export function draftErrors(d: MeetingDraft): Partial<Record<keyof MeetingDraft, string>> {
  const e: Partial<Record<keyof MeetingDraft, string>> = {};
  if (d.title.trim().length < 5) e.title = 'Give the meeting a title someone would recognise in a list.';
  if (!d.meetingDate) e.meetingDate = 'Pick a date.';
  if (d.venue.trim().length < 2) e.venue = 'Where is it being held? “Video conference” is fine.';
  if (!d.chairId) e.chairId = 'Somebody has to chair it.';
  if (d.projectIds.length === 0) e.projectIds = 'A meeting has to be about at least one project.';
  if (d.endTime <= d.startTime) e.endTime = 'It has to end after it starts.';
  if (d.vcLink.trim() && !/^https?:\/\//i.test(d.vcLink.trim())) {
    e.vcLink = 'A joining link should start with http:// or https://';
  }
  return e;
}

/** The fields both journeys share. The wizard and the composer each frame them. */
export function MeetingFields({
  draft,
  set,
  errors,
  showErrors,
}: {
  draft: MeetingDraft;
  set: (patch: Partial<MeetingDraft>) => void;
  errors: Partial<Record<keyof MeetingDraft, string>>;
  showErrors: boolean;
}) {
  const { user } = useSession();
  const [people, setPeople] = useState<Person[]>([]);
  const err = (k: keyof MeetingDraft) => (showErrors ? (errors[k] ?? null) : null);

  useEffect(() => {
    api<Person[]>('/users')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, []);

  const projects = user?.projects ?? [];

  return (
    <div className="grid gap-4">
      <Field label="Title" required error={err('title')}>
        <input
          className={`i ${err('title') ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Monthly Review — Project 1"
          aria-invalid={Boolean(err('title'))}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required>
          <select
            className="i"
            value={draft.category}
            onChange={(e) => set({ category: e.target.value as MeetingCategory })}
          >
            {(Object.keys(MEETING_CATEGORY_LABEL) as MeetingCategory[]).map((c) => (
              <option key={c} value={c}>
                {MEETING_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chairperson" required error={err('chairId')}>
          <select
            className={`i ${err('chairId') ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
            value={draft.chairId}
            onChange={(e) => set({ chairId: e.target.value })}
            aria-invalid={Boolean(err('chairId'))}
          >
            <option value="">Choose an officer…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.designation.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date" required error={err('meetingDate')}>
          <input
            type="date"
            className="i"
            value={draft.meetingDate}
            onChange={(e) => set({ meetingDate: e.target.value })}
          />
        </Field>
        <Field label="Starts" required>
          <input
            type="time"
            className="i"
            value={draft.startTime}
            onChange={(e) => set({ startTime: e.target.value })}
          />
        </Field>
        <Field label="Ends" required error={err('endTime')}>
          <input
            type="time"
            className={`i ${err('endTime') ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
            value={draft.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
            aria-invalid={Boolean(err('endTime'))}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Venue" required error={err('venue')}>
          <input
            className={`i ${err('venue') ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
            value={draft.venue}
            onChange={(e) => set({ venue: e.target.value })}
            placeholder="Conference Hall, UCF Head Office"
            aria-invalid={Boolean(err('venue'))}
          />
        </Field>
        <Field label="Joining link" error={err('vcLink')} hint="Shown on the agenda and in the MoM header.">
          <input
            className={`i ${err('vcLink') ? 'border-[#D98C7F] bg-[#FEF8F7]' : ''}`}
            value={draft.vcLink}
            onChange={(e) => set({ vcLink: e.target.value })}
            placeholder="https://meet.example.gov/…"
          />
        </Field>
      </div>

      <Field
        label="Projects"
        required
        error={err('projectIds')}
        hint="Only projects you are mapped to. The reference is built from this — one project uses its code, several use HO."
      >
        <div
          className={`grid gap-1.5 rounded-[10px] border p-2.5 sm:grid-cols-2 ${
            err('projectIds') ? 'border-[#D98C7F] bg-[#FEF8F7]' : 'border-line bg-white'
          }`}
        >
          {projects.length === 0 && (
            <span className="px-1 py-1 text-[12px] text-muted">
              You are not mapped to any project, so there is nothing to meet about yet.
            </span>
          )}
          {projects.map((p) => {
            const on = draft.projectIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] ${
                  on ? 'bg-ice font-semibold text-navy' : 'text-ink hover:bg-[#F6F9FC]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    set({
                      projectIds: on
                        ? draft.projectIds.filter((id) => id !== p.id)
                        : [...draft.projectIds, p.id],
                    })
                  }
                />
                <span className="font-mono text-[10.5px] text-muted">{p.code}</span>
                <span className="truncate">{p.name}</span>
              </label>
            );
          })}
        </div>
      </Field>
    </div>
  );
}
