---
name: macOS account provisioning
description: Durable constraints for safe standard-user creation through a root macOS agent.
---

Use only documented `sysadminctl` account-creation flags. Do not rely on `-role standard` or assume `-password -` means stdin across macOS versions. When stdin is unsupported, the documented password argument is the fallback, but the subprocess must avoid a shell, keep its lifetime minimal, and never return or log the password.

**Why:** An actual pilot produced a partial Directory Services record when the undocumented role flag and assumed stdin password mode were used, while suppressing stderr hid the cause.

**How to apply:** Classify existing records before mutation, treat a matching `milesEmployeeCode` plus incomplete required fields as the only recoverable partial case, never delete a home directory automatically, and verify `pwd`, required `dscl` fields, the Miles marker, and non-membership in `admin` before credential confirmation.

Password resets should use a separate encrypted reset credential record linked to the mapped provisioning record and command. The agent may retrieve the ciphertext-backed temporary password only for the reset operation; it becomes IT-revealable only after the OS reset succeeds.

**Why:** A reset credential must not conflict with the one-time provisioning credential, and revealing it before a successful reset could expose a password that was never applied.

**How to apply:** Keep reset plaintext out of command payloads, audit metadata, and database columns; validate assignment/provisioning identity server-side and independently revalidate marker, account completeness, UID/home, and standard role on the Mac.