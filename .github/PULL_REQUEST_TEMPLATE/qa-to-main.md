## Release Route

- [ ] `qa -> main`
- [ ] This is a release promotion PR, not a feature PR
- [ ] The source branch is frozen except for release blockers

## Release Summary

- Release name / tag:
- What is being promoted:
- Any follow-up work intentionally excluded:

## Validation

- [ ] `pnpm build`
- [ ] Browser smoke test on the release flow
- [ ] Backend / Docker checks if ingestion, persistence, or Q&A changed
- [ ] UI screenshots reviewed if the release touches the interface
- [ ] Delete / restore flow verified if the release changes data handling

## Release Readiness

- [ ] No blocking bugs remain open
- [ ] Release notes are ready
- [ ] Rollback or hotfix plan is documented
- [ ] Any required data migration or operational note is recorded

## Merge Action

- [ ] Merge `qa` into `main`
- [ ] Create or update the release tag if needed
- [ ] Announce the release after merge

