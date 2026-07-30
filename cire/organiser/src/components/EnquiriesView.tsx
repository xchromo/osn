import { useAuth } from "@shared/rp-auth/solid";
import { createResource, createSignal, onMount, Show } from "solid-js";
import { toast } from "solid-toast";

import { redirectToLogin } from "../lib/api";
import {
  addEnquiryToBudget,
  enquiryErrorMessage,
  fetchEnquiries,
  fetchMessages,
  replyEnquiry,
} from "../lib/enquiries-api";
import {
  enquiriesAccessor,
  ensureEnquiriesLoaded,
  invalidateEnquiries,
} from "../lib/enquiries-store";
import EnquiryInbox from "./EnquiryInbox";
import EnquiryThread from "./EnquiryThread";

interface EnquiriesViewProps {
  weddingId: string;
  currency: string;
  canEdit: boolean;
}

export default function EnquiriesView(props: EnquiriesViewProps) {
  const { authFetch, activeProfileId } = useAuth();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  onMount(() => {
    ensureEnquiriesLoaded(props.weddingId, () => fetchEnquiries(authFetch, props.weddingId)).catch(
      (err) => {
        if (
          typeof err === "object" &&
          err !== null &&
          ("_tag" in err
            ? (err as { _tag: unknown })._tag === "AuthExpiredError"
            : String(err).includes("AuthExpiredError"))
        ) {
          redirectToLogin();
        }
      },
    );
  });

  // Reactive accessor for the enquiry list.
  const enquiries = () => enquiriesAccessor(props.weddingId)() ?? [];

  // Find the selected enquiry by id from the cached list.
  const selectedEnquiry = () => {
    const id = selectedId();
    if (!id) return null;
    return enquiries().find((e) => e.id === id) ?? null;
  };

  // Fetch messages whenever the selected enquiry id changes.
  const [messages, { refetch }] = createResource(selectedId, (id) => {
    if (!id) return Promise.resolve([]);
    return fetchMessages(authFetch, props.weddingId, id);
  });

  const handleSend = async (message: string) => {
    const id = selectedId();
    if (!id) return;
    await replyEnquiry(authFetch, props.weddingId, id, message);
    // Refresh the inbox list so status/lastMessageAt update.
    invalidateEnquiries(props.weddingId);
    await ensureEnquiriesLoaded(props.weddingId, () => fetchEnquiries(authFetch, props.weddingId));
    // Refetch the thread messages.
    await refetch();
  };

  const handleAddToBudget = async () => {
    const id = selectedId();
    if (!id) return;
    try {
      await addEnquiryToBudget(authFetch, props.weddingId, id);
      toast.success("Added to budget");
    } catch (err) {
      toast.error(enquiryErrorMessage(err));
    }
  };

  return (
    // Master-detail, switched on the width this view actually gets rather than
    // the viewport's: narrow shows the inbox OR the thread (the classic
    // drill-in), wide shows both, so replying to a vendor no longer hides the
    // rest of the enquiries. Its own container (`@container/enquiries`) so the
    // switch survives the view being dropped into a narrower slot.
    <div class="@container/enquiries flex flex-col gap-4">
      <div class="flex flex-col gap-4 @3xl/enquiries:grid @3xl/enquiries:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)] @3xl/enquiries:items-start">
        {/* The inbox stays mounted while a thread is open and is hidden by CSS
            only on narrow layouts — so widening the panel mid-conversation
            reveals the list without a refetch, and `display: none` keeps its
            buttons out of the tab order when it isn't visible. */}
        <div classList={{ "@max-3xl/enquiries:hidden": selectedId() !== null }}>
          <EnquiryInbox
            items={enquiries()}
            currency={props.currency}
            selectedId={selectedId()}
            onOpen={setSelectedId}
          />
        </div>

        <Show
          when={selectedId() !== null && selectedEnquiry() !== null}
          fallback={
            // Wide-only: the detail column needs to say what it's for when
            // nothing is picked. Narrow has no second column to fill.
            <p class="border-border bg-surface/10 text-text-muted hidden rounded-sm border border-dashed px-4 py-6 text-[0.85rem] italic @3xl/enquiries:block">
              Pick an enquiry to read the conversation and reply.
            </p>
          }
        >
          <EnquiryThread
            enquiry={selectedEnquiry()!}
            messages={messages() ?? []}
            loading={messages.loading}
            error={messages.error ? enquiryErrorMessage(messages.error) : null}
            ownProfileId={activeProfileId() ?? ""}
            currency={props.currency}
            canEdit={props.canEdit}
            onBack={() => setSelectedId(null)}
            onSend={handleSend}
            onAddToBudget={handleAddToBudget}
          />
        </Show>
      </div>
    </div>
  );
}
