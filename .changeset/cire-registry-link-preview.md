---
"@cire/api": patch
"@cire/host": patch
---

Registry item pictures — link preview, an R2 copy at pick time, and the organiser field that drives both (PR 3 of 5).

An organiser building a gift list pastes a shop URL and wants the item's title
and picture without saving both by hand. `POST
/api/organiser/weddings/:weddingId/registry/link-preview` takes `{ url }` and
answers `{ title, siteName, images }` — up to six candidate image URLs, ranked
`og:image`/`twitter:image` first, then `<link rel="image_src">`, then `<img>` in
document order with anything declaring itself under 100px dropped.

**This is the first route in the API that fetches a URL a caller typed**, and
that makes it a server-side request forgery sink. Every other outbound call we
make goes to a host we chose, so the existing precedent — `pinterest-resolve.ts`
— defends itself with a host allowlist, which is exactly the tool that does not
exist when the destination is any shop on the internet. `services/link-preview.ts`
takes a different shape: `https:` only; a DNS-over-HTTPS pre-resolution whose
every A and AAAA answer is range-checked against loopback, RFC 1918, CGNAT,
link-local (the cloud metadata address in particular), `0.0.0.0/8` and multicast,
with IPv4-mapped and NAT64 addresses **unwrapped and re-checked** so the v4 rules
cannot be sidestepped by spelling them in v6; `redirect: "manual"` with the whole
scheme-and-address check re-run on every hop's `Location`, because a benign first
host that 302s to `http://169.254.169.254/` is the interesting attack and the
platform's own redirect follower would go there happily; and one `AbortSignal`
budget across all hops, a 512 KB cap read off the stream rather than trusted from
`Content-Length`, and a `text/html` content-type requirement.

The one gap is stated rather than hidden: **DoH pre-resolution is
time-of-check/time-of-use imperfect.** We vet the name's answers and then hand
the name to `fetch`, which resolves it again, so an attacker who controls the
zone can answer differently the second time. Closing that needs a connect-time
hook and workerd exposes none. It is recorded as S-M1 in the security backlog and
in the module's own doc comment, with what would change the answer.

Blocked URLs come back as a 400 with a stable `blocked_url` code and **no
reason** — telling a caller which rule fired turns the endpoint into a network
scanner with a clean oracle. The reason goes to the log instead. The route sits
behind the same gates as the registry writes (`osnAuth` → `weddingEditor` →
the `registry` entitlement) with its own per-organiser limiter appended at 10
requests a minute, since one authenticated call costs a full page fetch to a host
the caller named.

**The picked URL is never stored.** Preview hands back candidates; the moment an
organiser chooses one, `POST /registry/image/from-url` downloads it and writes
our own copy to R2, and the item holds an R2 key. Hotlinking would have meant a
picture that rots when the retailer re-slugs its CDN, a guest's IP and our
referrer disclosed to a shop on every page load, and — worst — bytes the shop can
swap after the organiser approved them. The URL in that request body is treated
as fully untrusted even though we emitted it, because the body is
client-controlled: the same guard runs again on it, hop by hop. The bytes must
then pass a `Content-Length` pre-check, the real read length, and a magic-byte
sniff (`detectImageType`) — a `Content-Type: image/png` over an HTML page is the
ordinary case here, so the header decides nothing. `POST /registry/image` takes a
direct upload through the same checks and the same `assets/<weddingId>/…` key
space as invite hero images, and `GET /registry/image/:name` serves our copy
through the Images transform binding with the key rebuilt server-side and the
response marked `private`. Deleting an item reaps its object, and the R2
reconciler counts registry keys as live references, so an abandoned add form
leaves nothing behind past the grace window. This closes S-L2 in the security
backlog, which asked for exactly this.

On the portal, `RegistryImageField` gives an item its picture either way: upload
a file, or paste a shop link and **choose** among what that page offers. The
candidates are a real radio group — roving tabindex, arrows, Home/End, and an
accessible name built from the page's own title rather than "image 1" — because
silently taking the first candidate picks the wrong picture on most shop pages.
Candidates are re-filtered to `https:` in the browser before any of them becomes
an `<img src>`; a page with no usable picture is a note offering the upload path,
not an error. The thumbnail is fetched with the organiser's token into an object
URL, since unlike the invite image route this one is gated.
