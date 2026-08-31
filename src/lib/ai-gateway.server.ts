import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createAgentAiProvider() {
  const geminiApiKey = process.env["GEMINI_API_KEY"];
  const googleGenerativeAiApiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  const geminiKey = geminiApiKey ?? googleGenerativeAiApiKey;
  const lovableKey = process.env["LOVABLE_API_KEY"];

  // Log key metadata only. Never print credential values.
  console.log("[createAgentAiProvider] Environment evaluation:", {
    geminiApiKeyPresent: Boolean(geminiApiKey),
    geminiApiKeyLength: geminiApiKey?.length ?? 0,
    googleGenerativeAiApiKeyPresent: Boolean(googleGenerativeAiApiKey),
    googleGenerativeAiApiKeyLength: googleGenerativeAiApiKey?.length ?? 0,
    lovableApiKeyPresent: Boolean(lovableKey),
    lovableApiKeyLength: lovableKey?.length ?? 0,
  });

  if (geminiKey) {
    const provider = createOpenAICompatible({
      name: "google-gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: geminiKey,
    });
    const result = { provider, modelName: "gemini-2.5-flash" };
    console.log("[createAgentAiProvider] Returning Gemini provider:", {
      result: { modelName: result.modelName, hasProvider: Boolean(result.provider), providerType: typeof result.provider },
      credentialSource: geminiApiKey ? "GEMINI_API_KEY" : "GOOGLE_GENERATIVE_AI_API_KEY",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    return result;
  }

  if (lovableKey) {
    const provider = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: {
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
    });
    const result = { provider, modelName: "google/gemini-3.7-flash" };
    console.log("[createAgentAiProvider] Returning Lovable provider:", {
      result: { modelName: result.modelName, hasProvider: Boolean(result.provider), providerType: typeof result.provider },
      baseURL: "https://ai.gateway.lovable.dev/v1",
    });
    return result;
  }

  console.warn("[createAgentAiProvider] Returning null: no non-empty Gemini, Google Generative AI, or Lovable key was found.");
  return null;
}
