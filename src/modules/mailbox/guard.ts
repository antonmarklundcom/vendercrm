import type { ReplyGuard } from "./reply";

// Sending limits for mailbox replies. E4 ships none beyond the recipient cap
// in reply.ts; E5 (blast-radius guard) fills this in.
export const mailboxReplyGuard: ReplyGuard = async () => null;
