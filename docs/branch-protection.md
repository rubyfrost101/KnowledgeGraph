# Branch Protection Plan

Use this plan to configure GitHub branch protection and required checks for the main release flow.

## Branches

- `dev` for day-to-day development
- `qa` for release validation
- `main` for stable releases

## Required checks

Create a GitHub Actions workflow at [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and require these checks:

- `CI / frontend-build`
- `CI / backend-check`
- `CI / docker-config`

## Recommended protection for `qa`

- Require a pull request before merging
- Require the required status checks listed above
- Require conversation resolution before merging
- Dismiss stale reviews when new commits are pushed
- Restrict direct pushes

## Recommended protection for `main`

- Require a pull request before merging
- Require the required status checks listed above
- Require at least one approving review
- Require conversation resolution before merging
- Dismiss stale reviews when new commits are pushed
- Restrict direct pushes
- Limit merges to PRs from `qa`

## Operational workflow

1. Develop on `dev`
2. Open a `dev -> qa` PR using [`.github/PULL_REQUEST_TEMPLATE/dev-to-qa.md`](../.github/PULL_REQUEST_TEMPLATE/dev-to-qa.md)
3. Let GitHub Actions run the required checks
4. After QA passes, open a `qa -> main` PR using [`.github/PULL_REQUEST_TEMPLATE/qa-to-main.md`](../.github/PULL_REQUEST_TEMPLATE/qa-to-main.md)
5. Merge only when the checks are green and release notes are ready

## Notes

- If you want stricter control, add CODEOWNERS later and require review from release owners
- If the backend grows more checks, keep the workflow job names stable so branch protection does not need frequent updates

