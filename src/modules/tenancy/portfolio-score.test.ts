import { describe, expect, it } from "vitest";
import { priorityScore } from "./portfolio-score";

const calm = {
  unreadConversations: 0,
  unassignedConversations: 0,
  whatsappInError: false,
  overdueTasks: 0,
  leads: 0,
  access: "active" as const,
};

describe("priorityScore", () => {
  it("is zero for a business with nothing pending", () => {
    expect(priorityScore(calm)).toBe(0);
  });

  it("ranks a customer waiting for an answer above a batch of new leads", () => {
    const waiting = priorityScore({ ...calm, unreadConversations: 1 });
    const leads = priorityScore({ ...calm, leads: 5 });
    expect(waiting).toBeGreaterThan(leads);
  });

  it("puts a broken WhatsApp connection above a couple of unread chats", () => {
    const broken = priorityScore({ ...calm, whatsappInError: true });
    const unread = priorityScore({ ...calm, unreadConversations: 2 });
    expect(broken).toBeGreaterThan(unread);
  });

  it("caps overdue tasks so a neglected backlog cannot drown out live customers", () => {
    const backlog = priorityScore({ ...calm, overdueTasks: 500 });
    expect(backlog).toBe(priorityScore({ ...calm, overdueTasks: 20 }));
    expect(priorityScore({ ...calm, unreadConversations: 5 })).toBeGreaterThan(backlog);
  });
});
