## Release Route

- [ ] `dev -> qa`
- [ ] This is a testing promotion PR, not a feature PR
- [ ] The branch is ready to freeze for QA validation

## Change Summary

- What changed:
- Why it is ready for QA:
- Any known limitations:

## Validation

- [ ] `pnpm build`
- [ ] Browser smoke test on the changed flow
- [ ] Backend / Docker checks if the change touches ingestion or persistence
- [ ] UI screenshots reviewed if the change affects layout or interaction
- [ ] Delete / restore flow verified if the change affects data handling

## QA Notes

- Test cases completed:
- Areas QA should focus on:
- Follow-up items:

## Merge Action

- [ ] Merge `dev` into `qa`
- [ ] Confirm required checks are green
- [ ] Promote only reviewed and tested changes

