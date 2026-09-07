import { describe, expect, it } from "vitest";
import {
  INITIAL_CONVERSATION_STATE,
  SETUP_TOPICS,
  advanceConversation,
  currentTopic,
  isConversationComplete,
  parseFaqBlocks,
} from "./conversation";

// The setup conversation's state machine (PLAN.md §16.5 step 2), pure so it
// can be tested without a database — the same split K1 used for
// checklist.ts. `conversation.ts`'s DB half (applyAnswer, submitSetupAnswer)
// is covered by an integration test instead.

describe("setup conversation state machine", () => {
  it("starts on the first topic and ends after the last", () => {
    expect(currentTopic(INITIAL_CONVERSATION_STATE)).toBe(SETUP_TOPICS[0]);
    expect(isConversationComplete(INITIAL_CONVERSATION_STATE)).toBe(false);

    let state = INITIAL_CONVERSATION_STATE;
    for (const topic of SETUP_TOPICS) {
      state = advanceConversation(state, { topic, answer: `respuesta de ${topic}` });
    }
    expect(currentTopic(state)).toBeNull();
    expect(isConversationComplete(state)).toBe(true);
    expect(Object.keys(state.answers)).toEqual([...SETUP_TOPICS]);
    expect(state.skipped).toEqual([]);
  });

  it("records a skip without an answer, and moves on anyway", () => {
    const first = SETUP_TOPICS[0]!;
    const state = advanceConversation(INITIAL_CONVERSATION_STATE, { topic: first, skip: true });
    expect(state.stepIndex).toBe(1);
    expect(state.skipped).toEqual([first]);
    expect(state.answers[first]).toBeUndefined();
  });

  it("treats a blank answer as a skip", () => {
    const first = SETUP_TOPICS[0]!;
    const state = advanceConversation(INITIAL_CONVERSATION_STATE, { topic: first, answer: "   " });
    expect(state.skipped).toEqual([first]);
  });

  it("ignores an answer to a topic that is not current — a stale double-post", () => {
    const state = advanceConversation(INITIAL_CONVERSATION_STATE, {
      topic: SETUP_TOPICS[3]!,
      answer: "fuera de orden",
    });
    expect(state).toEqual(INITIAL_CONVERSATION_STATE);
  });

  it("splits an FAQ answer into up to five question/answer blocks", () => {
    const answer = [
      "¿Hacen envíos?\nSí, a todo el país.",
      "¿Aceptan tarjeta?\nSí, débito y crédito.",
      "¿Tienen garantía?",
    ].join("\n\n");

    const blocks = parseFaqBlocks(answer);
    expect(blocks).toEqual([
      { title: "¿Hacen envíos?", body: "Sí, a todo el país." },
      { title: "¿Aceptan tarjeta?", body: "Sí, débito y crédito." },
      { title: "¿Tienen garantía?", body: null },
    ]);
  });

  it("caps FAQ blocks at five, so a long answer cannot flood the memory", () => {
    const answer = Array.from({ length: 8 }, (_, i) => `Pregunta ${i}`).join("\n\n");
    expect(parseFaqBlocks(answer)).toHaveLength(5);
  });
});
