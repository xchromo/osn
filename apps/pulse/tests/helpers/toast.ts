import { vi } from "vitest";

export const mockToastError = vi.fn();
export const mockToastSuccess = vi.fn();

/** Factory for `vi.mock("solid-toast", async () => solidToastMock())` */
export function solidToastMock() {
  return {
    default: Object.assign(vi.fn(), {
      error: mockToastError,
      success: mockToastSuccess,
    }),
  };
}
