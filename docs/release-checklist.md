# Release Checklist

Use this checklist before promoting changes from `dev` to `qa`, or from `qa` to `main`.

## Development branch

- [ ] Feature is scoped to `dev` or a short-lived feature branch
- [ ] Code compiles locally
- [ ] `pnpm build` passes
- [ ] Browser smoke test passes for the changed flow
- [ ] Any data or API changes are documented

## QA branch

- [ ] Merge only reviewed changes into `qa`
- [ ] Verify import, graph browsing, Q&A, and delete / restore flows
- [ ] Confirm no regression in backend upload / OCR / queue behavior
- [ ] Confirm screenshots or UX changes match the intended design
- [ ] Record known issues and follow-ups

## Main branch

- [ ] Only merge from `qa`
- [ ] No open blocking issues remain
- [ ] Release notes are ready
- [ ] If the change affects users, tag or announce the release

## Steam release line

- [ ] Merge only reviewed changes into `steam.qa`
- [ ] Verify Steam-specific UI, unlock states, and interaction flow
- [ ] Confirm Steam preview mode and game-like panels render correctly
- [ ] Merge to `steam.main` only after Steam QA passes

## Suggested PR flow

1. Open the PR against the branch that matches the release line
2. Fill out the template in `.github/pull_request_template.md`
3. Pass the checklist above
4. Merge into the QA branch
5. After QA passes, promote into the main branch
