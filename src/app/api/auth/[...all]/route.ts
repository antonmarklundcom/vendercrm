import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/modules/auth/server";

export const { GET, POST } = toNextJsHandler(auth);
