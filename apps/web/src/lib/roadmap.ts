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
