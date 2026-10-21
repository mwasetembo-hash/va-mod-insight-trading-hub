<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Trading rules (martingale, phases, profile) live as pure functions in src/lib/strategy.ts with tests in src/test/strategy.test.ts — keeps rules testable apart from UI.
- Deriv connection is a browser WebSocket client (src/lib/deriv.ts); the user's token stays in browser storage, so no backend is needed.
- Deriv credential validation and public defaults live in src/lib/deriv-config.ts, separately from trading rules, so legacy and PAT formats can be tested without real credentials.
- The browser Deriv client selects legacy v3 or Options REST/OTP WebSockets by App ID format; Options always prefers an active demo account and never falls back to real without explicit opt-in.
