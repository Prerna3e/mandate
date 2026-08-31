import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchCatalog } = await import("./public-data.server");
  return fetchCatalog();
});

export const listMerchantConsole = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchMerchantConsole } = await import("./public-data.server");
  return fetchMerchantConsole();
});

export const getSessionBundle = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { fetchSessionBundle } = await import("./public-data.server");
    return fetchSessionBundle(data.sessionId);
  });

export const listRecentSessions = createServerFn({ method: "GET" }).handler(async () => {
  const { fetchRecentSessions } = await import("./public-data.server");
  return fetchRecentSessions();
});
