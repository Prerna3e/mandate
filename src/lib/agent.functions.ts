import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RunInput = z.object({
  brief: z.string().min(4).max(400),
  budgetPaise: z.number().int().min(10000).max(2000000),
  mode: z.enum(["happy", "overcap", "payment_failure"]),
});

export const runAgentSessionFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RunInput.parse(input))
  .handler(async ({ data }) => {
    const { runAgentSession } = await import("./agent-run.server");
    return runAgentSession(data);
  });
