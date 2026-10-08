import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./helpers/msw";

// Gerçek ağa çıkan istek testi başarısız kılar.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
