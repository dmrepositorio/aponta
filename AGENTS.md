# Aponta delivery instructions

These rules apply to agents working in this repository. See `docs/delivery/WORKFLOW.md` for the operating contract and `docs/delivery/RELEASE.md` for integration and deploy.

- Each deliverable has one primary GitHub issue and one canonical Multica parent that runs through the workflow `Dev Pipeline`, one stage at a time: `/spec` → `/plan` → `/build` + `/test` → `/review` → `/ship`. planning-and-task-breakdown implementation tickets are GitHub sub-issues of the primary issue and inherit its identity. Preserve existing decisions, completed stages and scope exclusions.
- Squad DM runs the flow with `dm_triagem` (`/spec`), `dm_arquiteto` (`/plan`), `dm_developer` (`/build` + `/test`), `dm_qualidade` (`/review`) and `dm_entrega` (`/ship`); `dm_lider` unblocks any stage that hits a blocker (`blocked` status). QA never reviews its own work and never fixes its own finding; it reviews the exact final SHA and posts the verdict as a comment on the PR.
- Use a short branch and PR. Reuse an existing branch/PR when resuming; never force updates onto `main`. Do not reset, stash or clean another contributor's work. Merge goes only through the native merge queue, and `dm_entrega` queues the PR in `/ship` once the gates in `docs/delivery/WORKFLOW.md` are proven (QA approval on the exact SHA, both checks green on the head, PR ready, `DMTE-N` title, `Entrega:`/`Refs` lines): `gh pr merge N --squash`, never `--admin` or any bypass. The `CD (Produção)` workflow then builds the commit once and deploys it to production after the approval of the `production` environment. There is no staging. Do not invoke CD, merge outside the queue, or run `scripts/aponta_release.py` or Docker against production; see `docs/delivery/RELEASE.md`.
- Confirm the checkout, remote and base SHA. Keep implementation/review WIP at one delivery; up to two ready tickets of that delivery may run in parallel, each in a new, exclusive worktree. The executor owns product implementation; exploratory prototypes stay on separate branches.
- New features and large refactors require interview-me → spec-driven-development → planning-and-task-breakdown before implementation, regardless of size. A small confirmed bug may use the issue criteria; larger work needs a SPEC with numbered ACs (`AC-NN`), contracts, risks, authorization and tests. Reference the existing architecture docs; avoid unrelated rewrites.
- For behavior changes, the test that describes the behavior must fail by assertion before the implementation and pass after. Import/setup/syntax failures are not RED: create an importable neutral stub if needed. Never weaken, skip or delete a test to reach green. Say in the PR which test failed first and the command that proved it.
- Reuse the Aponta DS (`apps/web/src/components/ds`) and tokens. Review `docs/architecture/03-sankhya-ds-parity.md`. New/changed reusable DS components need appropriate stories or a documented exception. Do not introduce Carbon or Next.js into this React/Vite app.
- Before requesting review run the relevant tests, typecheck and build; the CI gates are `Typecheck, unit tests, build` and `E2E (Playwright, full stack)`. QA reproduces relevant checks independently, examines RBAC and tenant boundaries, and approves the exact SHA.
- CI verifies the PR. Do not use `Closes`/`Fixes`. The PR carries `Entrega: #N` (tickets it delivers) and `Refs #SPEC`; after the production deploy succeeds, the `close-issues` job of the CD closes the delivered tickets and closes the SPEC when its last sub-issue closes. A delivery is: implemented, reviewed, ready to integrate, integrated, published in production (`docs/delivery/WORKFLOW.md`). Declare only the state the evidence proves; a closed issue means published, and the user reopens it if the delivery is rejected.
- Local E2E on a shared machine runs through `scripts/e2e_isolated.sh` (own database and ports per run). New behavior with an external effect ships behind a feature flag registered with owner, default and removal date (`apps/api/src/feature-flags`). Dependency updates and issue audits use the generic skills of the Agent Skills package (`deprecation-and-migration`, `security-and-hardening`); see `docs/agents/akita-mapping.md`.
- Never log credentials or use real customer data in fixtures. Record bounded summaries and artifact links rather than repeatedly loading full logs.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`dmrepositorio/aponta`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), unchanged from the skill defaults. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.

### Engineering methods and project profile

The flow is `/spec` → `/plan` → `/build` + `/test` → `/review` → `/ship`, from `addyosmani/agent-skills` (pinned in `skills-lock.json`). Read `docs/agents/engineering-workflow.md` for the command → skill → agent map, role boundaries, visual validation and context transfer. The Aponta SPEC and TDD criteria are in the "Critérios do Aponta" section of that file. Preserve human decisions; an unresolved choice blocks its dependent action.
