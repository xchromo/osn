---
"@cire/api": patch
"@cire/host": patch
"@cire/invites": patch
---

Fix every `house/no-stacked-doc-block` site in these packages (xchromo/osn#926).

Same defect and treatment as the versioned-package changeset for this branch: a stacked doc block only has its last block attached, so the earlier one silently documents nothing. Merged where two blocks described the same declaration; relocated to line 1 where a genuine module doc had been pushed past the rule's line-1 exemption by a leading `import`. No prose rewritten, no behavior changed, every fix spot-checked against the real diff.
