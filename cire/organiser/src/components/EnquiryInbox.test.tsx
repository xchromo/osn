// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EnquiryListItem } from "../lib/enquiries-store";
import EnquiryInbox from "./EnquiryInbox";

const item = (o: Partial<EnquiryListItem> = {}): EnquiryListItem => ({
  id: "enq_1",
  weddingId: "w",
  directoryVendorId: "dv",
  vendorId: "v",
  zapChatId: "c",
  status: "quoted",
  createdBy: "p",
  quotedMinor: 250000,
  lastMessageAt: 1,
  createdAt: 1,
  updatedAt: 1,
  vendorName: "Blue Roses",
  category: "florals",
  ...o,
});
afterEach(cleanup);

describe("EnquiryInbox", () => {
  it("shows an empty state when there are no enquiries", () => {
    render(() => <EnquiryInbox items={[]} currency="AUD" onOpen={() => {}} />);
    expect(screen.getByText(/no enquiries yet/i)).toBeInTheDocument();
  });
  it("renders a row and fires onOpen", () => {
    const onOpen = vi.fn();
    render(() => <EnquiryInbox items={[item()]} currency="AUD" onOpen={onOpen} />);
    expect(screen.getByText("Blue Roses")).toBeInTheDocument();
    expect(screen.getByText("Florals")).toBeInTheDocument();
    expect(screen.getByText(/\$2,500\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Blue Roses"));
    expect(onOpen).toHaveBeenCalledWith("enq_1");
  });

  // `selectedId` only matters where the inbox and the thread are on screen
  // together (the wide master-detail layout) — the row has to say which
  // conversation is being read.
  it("marks the open enquiry with aria-current", () => {
    render(() => (
      <EnquiryInbox
        items={[item(), item({ id: "enq_2", vendorName: "Southbank Strings" })]}
        currency="AUD"
        selectedId="enq_2"
        onOpen={() => {}}
      />
    ));
    expect(screen.getByRole("button", { name: /Southbank Strings/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /Blue Roses/ })).not.toHaveAttribute("aria-current");
  });

  it("marks no row when nothing is open", () => {
    render(() => <EnquiryInbox items={[item()]} currency="AUD" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /Blue Roses/ })).not.toHaveAttribute("aria-current");
  });
});
