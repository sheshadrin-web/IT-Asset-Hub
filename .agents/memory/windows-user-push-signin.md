---
name: Windows User Push sign-in verification
description: Windows Home-safe account provisioning and retry-proof one-time credential status rules.
---

Windows provisioning must use the built-in Users and Administrators SIDs rather than localized group display names. Do not use or set `EnumerateLocalUsers` as a general local-account sign-in fix: it is domain-join policy and is neither a Windows Home tile control nor safe global behavior.

**Why:** Windows Home Single Language localizes group names, and a false negative in an English-name lookup can misclassify account privilege. The reported sign-in issue also cannot safely be fixed by changing a global, domain-oriented enumeration policy.

**How to apply:** Repair only the employee account's standard Users membership and explicit UserList hide flag, then validate the newly created credential with native interactive logon. Any retry that finds an existing account must require a server-side, same-command attestation that its credential is still available; never regenerate or fetch the one-time credential just to validate it.