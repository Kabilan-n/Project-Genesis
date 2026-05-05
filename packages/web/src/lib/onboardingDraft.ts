'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { apiFetch } from './auth';

export interface OnboardingAnswer {
  question_number: number;
  answer_index: number;
}

export interface OnboardingDraft {
  sessionId: string | null;
  answers: OnboardingAnswer[];
  name: string;
  appearance: Record<string, unknown>;
  /** Set when the user opens the wizard. Compared on rehydrate; older
   *  drafts (>24h) are dropped to avoid confusing UX. */
  startedAt: number | null;
}

interface OnboardingStore extends OnboardingDraft {
  setSession: (sessionId: string) => void;
  setAnswer: (questionNumber: number, answerIndex: number) => void;
  setName: (name: string) => void;
  setAppearance: (appearance: Record<string, unknown>) => void;
  reset: () => void;
  isExpired: () => boolean;
  /** Submit the whole draft to /onboarding/sessions/:id/complete-batch.
   *  Throws on validation errors or non-2xx responses; the wizard
   *  catches and surfaces the message without losing the draft. */
  submit: () => Promise<unknown>;
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const initial: OnboardingDraft = {
  sessionId: null,
  answers: [],
  name: '',
  appearance: {},
  startedAt: null,
};

export const useOnboardingDraft = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      ...initial,

      setSession: (sessionId) =>
        set((s) => ({
          sessionId,
          startedAt: s.startedAt ?? Date.now(),
        })),

      setAnswer: (question_number, answer_index) =>
        set((s) => {
          const next = s.answers.filter((a) => a.question_number !== question_number);
          next.push({ question_number, answer_index });
          next.sort((a, b) => a.question_number - b.question_number);
          return { answers: next };
        }),

      setName: (name) => set({ name }),
      setAppearance: (appearance) => set({ appearance }),

      reset: () => set({ ...initial }),

      isExpired: () => {
        const startedAt = get().startedAt;
        if (!startedAt) return false;
        return Date.now() - startedAt > DRAFT_TTL_MS;
      },

      submit: async () => {
        const { sessionId, answers, name, appearance } = get();
        if (!sessionId) throw new Error('No onboarding session — start the wizard first.');
        if (!name || name.length < 2) throw new Error('Name must be at least 2 characters.');

        const res = await apiFetch(
          `/onboarding/sessions/${sessionId}/complete-batch`,
          {
            method: 'POST',
            body: JSON.stringify({ answers, name, appearance }),
            timeoutMs: 60_000, // identity + traits insert chain can take a moment
          },
        );

        if (!res.ok) {
          let msg = `Submission failed (${res.status})`;
          try {
            const body = await res.json();
            if (body?.error) msg = body.error;
          } catch { /* keep default */ }
          throw new Error(msg);
        }
        return res.json();
      },
    }),
    {
      name: 'genesis-onboarding-draft',
      // sessionStorage so a fresh tab gets a fresh draft; the user explicitly
      // staying in one tab keeps theirs across reloads.
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.sessionStorage : (undefined as any),
      ),
      // Drop drafts older than 24h on rehydrate.
      onRehydrateStorage: () => (state) => {
        if (state?.startedAt && Date.now() - state.startedAt > DRAFT_TTL_MS) {
          state.sessionId = null;
          state.answers = [];
          state.name = '';
          state.appearance = {};
          state.startedAt = null;
        }
      },
    },
  ),
);
