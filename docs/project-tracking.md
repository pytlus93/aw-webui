# Project tracking management (stage 1)

Open **Tools → Projects & tasks** (`/#/projects`) with the matching extended
Rust server. This module stores its authoritative data in AW's SQLite database;
it does not change captured events, category billing or the existing work report.
The Python server remains unchanged and displays a module-unavailable notice.

Create projects, nested projects and tasks, rename/reparent them, configure
optional descriptions/CaseIds, archive branches, and search names/paths/CaseIds.
Tasks require a parent. Projects cannot be placed below tasks. Invalid cycles,
descendant reporting targets and invalidated descendant policies are rejected
atomically by the server. Archived ancestors apply to their descendants; enable
**Show archived branches** to edit/unarchive them. Nodes are not hard deleted.

Billing and reporting are independent. Billing inherits from the nearest
explicit policy; reporting can inherit, target this node, or target an ancestor.
T&M hourly rates and fixed fees are optional exact decimal strings with a
three-letter uppercase currency. Changing to inherited/non-billable clears terms
in the submitted payload. Fixed work still records hours in later stages; it does
not automatically create a T&M charge. The resolved policy uses the selected
work date to show the effective ActivityId. Store dated IDs on the report target,
not necessarily the task. Mapping ends are exclusive and overlapping mappings
are rejected. CaseId does not substitute for a missing ActivityId.

Workspace settings include an explicit IANA reporting time zone (default UTC).
The initial work date uses that zone rather than the browser's local date.
Existing workspace/node data receives UTC/empty description/null terms defaults.
Descriptions, identifiers and billing terms are local metadata with indefinite
revision/retry retention; do not put secrets in them. No tracking-event data fields
are emitted by this management module. Watcher payload contracts are unchanged.

Each save sends the workspace ETag and a random idempotency key. An interrupted
response preserves the exact request **in memory** and blocks further writes
until **Retry save** resolves it. A replay retrieves the original committed
result then refreshes current data. Reloading/closing the whole page loses that
in-memory pending request: reload the authoritative workspace and inspect it
before recreating an edit. A stale edit stays in the form with a conflict message;
Reload refreshes server data without overwriting that draft. Review/reapply it.
New node drafts retain their UUID. No project entities are stored in localStorage.

## Local build and validation

Requires Node/npm (validated: Node 24.19, npm 11.17), Git and PowerShell on Windows.
From this checkout:

```powershell
./scripts/validate-project-tracking.ps1 -Install # fresh checkout
./scripts/validate-project-tracking.ps1          # dependencies already installed
```

The script fails immediately on errors, prepares upstream logo assets, checks
changed UI/test files with zero lint warnings, runs 15 tests (seven new project
tests plus eight existing router tests), then builds production assets in `dist/`.
GitHub Actions is unavailable and is not used. Inherited workflows are untouched.
Upstream Sass/Babel deprecation and bundle-size notices remain build warnings.

Build the matching server from the sibling `aw-server-rust` checkout:

```powershell
./scripts/validate-project-tracking.ps1 -Offline
./scripts/build-project-tracking.ps1 -Offline
```

For an isolated development preview (not an installed replacement), create a
local config file and start the server with an explicitly separate database:

```powershell
New-Item -ItemType Directory -Force local/project-validation
'address = "127.0.0.1"' | Set-Content local/project-validation/config.toml
./target/debug/aw-server.exe --profile project-validation --port 5691 `
  --dbpath local/project-validation/aw.db --config local/project-validation/config.toml `
  --webpath ../aw-webui/dist --no-legacy-import
```

Open `http://127.0.0.1:5691/#/projects`. Keep this server on loopback. Local
validation output is ignored; never commit a database/config/activity log.

## Evidence and limits

Windows production build, lint and the scripted 15 tests passed. The browser was
checked against the real Rust process with a synthetic isolated database: project
creation, exact rate, child task creation, inherited policy, dated root ActivityId
resolved on a child, and persistence after a real server-process restart and
page reload. [Synthetic screen](project-tracking-synthetic.jpg).
The matching server also builds with embedded UI assets; stop the development
server before rebuilding its executable on Windows. The datastore separately
verifies process-independent SQLite durability/reopen.
This is development-host evidence, not installed AW/reboot/lifecycle evidence.
No macOS/Linux/Android runtime or Python-host browser check is claimed.

Manual timeline booking, time entries, review/export/report states, immutable
report snapshots, enrichment and rules remain later stages. Stage 1's audit
snapshots are stored by the backend but have no history viewer yet. There is no
installer, production host replacement or multi-device domain synchronization.
