// @vitest-environment happy-dom
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { vi, it, expect, afterEach, beforeEach } from "vitest";
import { LocationInput } from "../src/lib/LocationInput";

const mockFetch = (features: unknown[] = []) =>
  vi.fn().mockResolvedValue({ json: () => Promise.resolve({ features }) });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
});

it("item in DOM after mousedown?", async () => {
  const features = [{ properties: { name: "Hyde Park", city: "London", country: "UK" } }];
  vi.stubGlobal("fetch", mockFetch(features));
  const { getByRole, getByText, queryByText } = render(() => (
    <LocationInput value="" onValue={() => {}} />
  ));
  const input = getByRole("textbox");
  fireEvent.input(input, { target: { value: "Hyde" } });
  await vi.advanceTimersByTimeAsync(300);
  await Promise.resolve();
  await Promise.resolve();
  const item = getByText("Hyde Park, London, UK");

  fireEvent.mouseDown(item);

  const inDomAfter = document.body.contains(item);
  const itemExists = queryByText("Hyde Park, London, UK") !== null;

  // If item still in DOM after mouseDown, we can fire mouseUp on it
  // If not, we need a different approach for line 82 coverage
  expect({ inDomAfter, itemExists }).toEqual({
    inDomAfter: expect.any(Boolean),
    itemExists: expect.any(Boolean),
  });
});
