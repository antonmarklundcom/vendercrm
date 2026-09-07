// The setup assistant's conversation (PLAN.md §16.5 step 2): one fixed topic
// at a time, voseo, "saltar" always allowed. Pure and import-free, like
// K1's checklist.ts, so the state machine is testable without a database —
// the DB half (writing an answer into the memory, persisting progress on the
// `setup_plans` draft row) lives in ./plan.ts, which imports these.
//
// Deliberately one answer per topic, even where §16.5 groups two questions
// under one bullet ("horario y dirección", "señas/cancelación/pagos"): a
// single free-text box per topic keeps this state machine small, and the
// model reads free text as well as it reads a form field. FAQs are the one
// topic that fans out — an admin's answer is split into up to 5 facts, one
// per blank-line-separated block.

export const SETUP_TOPICS = [
  "about",
  "contactToday",
  "hoursAddress",
  "servicesPrices",
  "policies",
  "faqs",
  "tone",
  "neverPromise",
] as const;
export type SetupTopic = (typeof SETUP_TOPICS)[number];

export const MAX_FAQS_PER_ANSWER = 5;

export type SetupConversationState = {
  /** Index into SETUP_TOPICS of the next unanswered topic. */
  stepIndex: number;
  /** What was typed for each topic already answered (not skipped). */
  answers: Partial<Record<SetupTopic, string>>;
  skipped: SetupTopic[];
};

export const INITIAL_CONVERSATION_STATE: SetupConversationState = {
  stepIndex: 0,
  answers: {},
  skipped: [],
};

/** The topic still waiting for an answer, or null once every topic is done. */
export function currentTopic(state: SetupConversationState): SetupTopic | null {
  return SETUP_TOPICS[state.stepIndex] ?? null;
}

export function isConversationComplete(state: SetupConversationState): boolean {
  return state.stepIndex >= SETUP_TOPICS.length;
}

/**
 * Pure transition: records an answer (or a skip) for whichever topic is
 * current and moves to the next one. Answering — or skipping — a topic that
 * is not current is a no-op, since the UI only ever posts the current one,
 * but a resumed page reloaded twice must not double-apply.
 */
export function advanceConversation(
  state: SetupConversationState,
  input: { topic: SetupTopic; answer?: string; skip?: boolean },
): SetupConversationState {
  if (currentTopic(state) !== input.topic) return state;

  const answers = { ...state.answers };
  const skipped = [...state.skipped];
  const trimmed = input.answer?.trim();

  if (input.skip || !trimmed) {
    skipped.push(input.topic);
  } else {
    answers[input.topic] = trimmed;
  }

  return { stepIndex: state.stepIndex + 1, answers, skipped };
}

/** Splits an FAQ answer into up to five facts: blank-line-separated blocks,
 *  first line the question, the rest the answer. */
export function parseFaqBlocks(answer: string): Array<{ title: string; body: string | null }> {
  return answer
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .slice(0, MAX_FAQS_PER_ANSWER)
    .map((block) => {
      const [first, ...rest] = block.split("\n");
      return { title: first!.trim(), body: rest.join("\n").trim() || null };
    });
}

export const TONE_WORDS = ["cercano", "formal", "directo"] as const;

/** A loose first-word match against the three tones — "cercano y directo"
 *  still reads as `cercano`. No match leaves `tone` null and keeps the whole
 *  answer as the free-text note, which is exactly what a form's "otro" would
 *  have produced. */
export function matchTone(answer: string): { tone: (typeof TONE_WORDS)[number] | null; note: string } {
  const lower = answer.toLowerCase();
  const tone = TONE_WORDS.find((candidate) => lower.includes(candidate)) ?? null;
  return { tone, note: answer.slice(0, 500) };
}
