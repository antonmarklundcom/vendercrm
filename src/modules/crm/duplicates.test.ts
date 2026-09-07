import { describe, expect, it } from "vitest";
import { findDuplicateCandidates, type DuplicateCandidateRow } from "./duplicates";

const row = (id: string, name: string, phone: string, email: string | null = null): DuplicateCandidateRow => ({
  id,
  name,
  phone,
  email,
});

describe("findDuplicateCandidates", () => {
  it("matches by exact normalized email", () => {
    const pairs = findDuplicateCandidates([
      row("a", "Ana Pérez", "+595981000001", "Ana@Example.com"),
      row("b", "Ana P.", "+595981999999", " ana@example.com "),
    ]);

    expect(pairs).toEqual([{ a: expect.objectContaining({ id: "a" }), b: expect.objectContaining({ id: "b" }), reason: "email" }]);
  });

  it("matches by folded name plus the first six phone digits", () => {
    const pairs = findDuplicateCandidates([
      row("a", "José Da Silva", "+595981123456"),
      row("b", "jose da silva", "+595981123999"),
    ]);

    expect(pairs).toEqual([
      { a: expect.objectContaining({ id: "a" }), b: expect.objectContaining({ id: "b" }), reason: "nameAndPhone" },
    ]);
  });

  it("does not match same name with a different phone prefix", () => {
    const pairs = findDuplicateCandidates([
      row("a", "Ana Pérez", "+595981123456"),
      row("b", "Ana Pérez", "+595982999999"),
    ]);
    expect(pairs).toEqual([]);
  });

  it("does not match same phone with a different name", () => {
    const pairs = findDuplicateCandidates([
      row("a", "Ana Pérez", "+595981123456"),
      row("b", "Bruno Gómez", "+595981123999"),
    ]);
    expect(pairs).toEqual([]);
  });

  it("never reports the same pair twice even when it matches both ways", () => {
    const pairs = findDuplicateCandidates([
      row("a", "Ana Pérez", "+595981123456", "ana@example.com"),
      row("b", "Ana Pérez", "+595981123999", "ana@example.com"),
    ]);
    expect(pairs).toHaveLength(1);
  });

  it("is empty-input safe", () => {
    expect(findDuplicateCandidates([])).toEqual([]);
  });
});
