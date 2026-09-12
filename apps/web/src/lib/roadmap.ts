import type { Capability } from '@mom/shared';

/**
 * Which phase builds which screen.
 *
 * The navigation shows every route from the agreed design, including the ones
 * not built yet — the same principle as "locked, not hidden" in
 * docs/07-UI-SPEC.md. A link that silently 404s is worse than no link; a link
 * that says which phase builds it is a plan you can read off the sidebar.
 *
 * Delete an entry when its screen ships. The real route then takes over, since
 * a specific route always wins over the catch-all.
 */
export interface Planned {
  /** Build-plan phase number, or null when it is not yet scheduled. */
  phase: number | null;
  /** Ticket ids in docs/08-BUILD-PLAN.md. */
  tickets: string[];
  title: string;
  /** What the screen does, in the words of the PRD. */
  blurb: string;
  cap?: Capability;
}

export const ROADMAP: Record<string, Planned> = {
  '/login': {
    phase: 1,
    tickets: ['P1-01', 'P1-07'],
    title: 'Sign in',
    blurb:
      'Password plus an OTP, then a session whose capabilities are re-read from the database on every request — so an access change takes effect without anyone signing out.',
  },
  '/calendar': {
    phase: 6,
    tickets: ['P6-02'],
    title: 'Calendar',
    blurb:
      'Months you can step through, colour-coded conducted / upcoming / planning / instant, with the pipeline and recently-held lists beside it.',
  },
  '/meetings': {
    phase: 3,
    tickets: ['P3-09', 'P3-10'],
    title: 'Meetings',
    blurb:
      'The list and both journeys: an instant meeting the coordinator composes and launches in one pass, and the four-step scheduled wizard. Then the five tabs on a held meeting — agenda, attendance, items, documents, signed MoM.',
  },
  '/minutes': {
    phase: 4,
    tickets: ['P4-01', 'P4-11'],
    title: 'Minutes editor',
    blurb:
      'A rich-text editor, sanitised server-side and versioned, with the typed entry form beside it: one dropdown switches between an Action and a Clarification and the form changes with it.',
    cap: 'record_minutes',
  },
  '/mom': {
    phase: 4,
    tickets: ['P4-06', 'P4-07', 'P4-12'],
    title: 'MoM register',
    blurb:
      'Generate, submit, approve or return, sign and circulate — with the A4 document, the DRAFT watermark and the approval console. Circulation is what makes the action items live.',
  },
  '/register': {
    phase: 6,
    tickets: ['P6-03'],
    title: 'Actions & clarifications',
    blurb:
      'Every commitment with its owners, due date, ageing and status, filterable and exportable. It counts only activated items — the ones whose MoM has actually been circulated.',
  },
  '/reports': {
    phase: 6,
    tickets: ['P6-04', 'P6-05'],
    title: 'Reports',
    blurb:
      'Six reports — action taken, meeting register, pending approvals, officer performance, clarification log, project status — in JSON, CSV and PDF, and subscribable.',
  },
  '/projects': {
    phase: 2,
    tickets: ['P2-01', 'P2-05'],
    title: 'Projects',
    blurb:
      'The project master and its four tabs: project info, officers, ULB info and documents. A document cannot be uploaded without a name and a type.',
  },
  '/people': {
    phase: 2,
    tickets: ['P2-06'],
    title: 'People & designations',
    blurb:
      'Users, designations and departments, with project mapping. People are retired, never deleted, because they are named in minutes that must stay readable.',
  },
  '/access': {
    phase: 1,
    tickets: ['P1-06', 'P1-07'],
    title: 'Access control',
    blurb:
      'The designation × capability matrix, and a checker that answers "what can this officer actually do, on which projects". Access is computed from designation and project mapping, never assigned per user.',
    cap: 'manage_access',
  },
  '/communications': {
    phase: 5,
    tickets: ['P5-11', 'P5-12'],
    title: 'Communication log',
    blurb:
      'Every message sent, automatic or shared by hand, with its recipient, channel and delivery state. Plus the 27 notification rules and the WhatsApp templates.',
  },
  '/audit': {
    phase: 6,
    tickets: ['P6-06'],
    title: 'Audit trail',
    blurb:
      'Append-only, read-only, and enforced by the database rather than by convention. There is no route that can change a row here, and there never will be.',
  },
  '/help': {
    phase: null,
    tickets: [],
    title: 'How it works',
    blurb:
      'The walkthrough from the prototype: the two meeting journeys, what circulation does, and why nobody confirms their own work.',
  },
};

/** The planned screen for a path, if it is one we know about. */
export function plannedFor(path: string): Planned | undefined {
  const first = '/' + (path.split('/').filter(Boolean)[0] ?? '');
  return ROADMAP[first];
}
