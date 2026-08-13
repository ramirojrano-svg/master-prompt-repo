// app/api/auth/[...nextauth]/route.ts — endpoints de Auth.js.
import { handlers } from "../../../../src/lib/auth.ts";

export const { GET, POST } = handlers;
