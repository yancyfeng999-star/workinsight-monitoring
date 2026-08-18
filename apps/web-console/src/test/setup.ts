import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetUnauthorizedRedirect } from "../lib/api";

afterEach(() => {
  cleanup();
  resetUnauthorizedRedirect();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
