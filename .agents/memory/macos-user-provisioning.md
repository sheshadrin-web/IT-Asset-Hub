---
name: macOS account provisioning
description: Durable constraints for safe standard-user creation through a root macOS agent.
---

Use only documented `sysadminctl` account-creation flags. Do not rely on `-role standard` or assume `-password -` means stdin across macOS versions. When stdin is unsupported, the documented password argument is the fallback, but the subprocess must avoid a shell, keep its lifetime minimal, and never return or log the password.

**Why:** An actual pilot produced a partial Directory Services record when the undocumented role flag and assumed stdin password mode were used, while suppressing stderr hid the cause.

**How to apply:** Classify existing records before mutation, treat a matching `milesEmployeeCode` plus incomplete required fields as the only recoverable partial case, never delete a home directory automatically, and verify `pwd`, required `dscl` fields, the Miles marker, and non-membership in `admin` before credential confirmation.