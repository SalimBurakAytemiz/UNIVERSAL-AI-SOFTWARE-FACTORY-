<!-- //TR: UI-109 — POST 403 ACTION_DENIED neden kodunun DENIED rozetiyle gösterimi (yalnız renderer). -->
# UI-109 — ACTION_DENIED reason code

- `describePostResult`: 403 + `{error:'ACTION_DENIED', reason}` → `post.err.denied` with `{status, reason}`.
- Reason is cut at the first `:`; used only if it matches `/^[A-Z][A-Z0-9_]{1,63}$/`. Otherwise `post.err.auth` is kept; no reason is invented.
- `statusBlock`: for `post.err.denied` a `DENIED` state pill (icon + text) precedes the message; other statuses are unchanged.
- No new endpoint, POST, IPC or storage. A denial never yields a positive/VERIFIED state.
