---
name: Supabase Edge browser CORS
description: CORS requirements for browser-invoked Supabase Edge Functions.
---

Supabase browser clients send `x-client-info` during Edge Function invocation. The function's `OPTIONS` response must include it in `Access-Control-Allow-Headers`, or the browser can report a fetch failure before the function receives the request.

**Why:** A valid deployed function and authenticated RPC can still appear unreachable when the preflight omits a client header added by `supabase-js`.

**How to apply:** Test the production function with an `OPTIONS` request that asks for `authorization,apikey,content-type,x-client-info`; verify HTTP 200 and that the allow-list includes all four headers.