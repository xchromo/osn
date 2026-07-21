---
"@cire/api": patch
---

Add vendor-side enquiry routes + claim-flush wiring (Vendors S4 PR B).

New `/api/vendor/enquiries` surface (osnAuth-gated) for the vendor operator:
list enquiries across their claimed listings, read a thread, reply, and attach a
structured quote (`{ amountMinor, note? }` → mirrors `vendors.quoted_minor` +
`vendor_enquiries.quoted_minor`, status `quoted`, Zap message + couple email).
The per-enquiry org gate resolves the owning org from the enquiry's listing and
404s on a cross-tenant id (no enumeration); reply/quote run behind the per-user
enquiry limiter.

Central fix: `directoryService.consumeClaim(token, orgId, claimingProfileId)`
now records `directory_vendors.claimed_by_profile_id` in the same UPDATE that
binds `owner_org_id`, so a production-claimed listing reads as CLAIMED by the
enquiry service. After a successful claim, the vendor-portal consume handler
flushes any enquiries buffered against the listing via
`enquiryService.onVendorClaimed` (best-effort).
