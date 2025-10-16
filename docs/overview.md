# DoodleBot Overview

## Core Services

### Moderation Engine (`src/moderation/moderationEngine.js`)
- Initializes once per process and hot-reloads whenever `data/moderation.json` changes.
- Filters links, invites, media, profanity, and custom keywords while respecting bypass scopes for roles/channels/users.
- Multi-signal anti-spam (messages, mentions, links, emojis, attachments) with auto-timeouts and evidence capture.
- Escalation ladder (warn -> timeout -> ban) with configurable thresholds; every action updates the linked case.
- Persists outcomes through `caseStore`, emits moderation alerts, and applies DM templates before notifying members.

### Case Store (`src/moderation/caseStore.js`)
- Stores up to 500 cases in `data/moderation/cases.json` with per-user stats and rolling totals.
- Tracks actions, messages (jump URLs + attachment metadata), participants, audit log entries, and unread counts.
- Supports open/update/append flows, status transitions, deletion, SLA tracking, and event subscriptions for live updates.

### Support Workflow (`src/support/supportWorkflow.js`)
- `/support` guided flow (guild or DM) with topic selection, modal intake, TTL enforcement, and audit trail.
- Ensures/creates a case, posts an intake embed in the configured channel, and notifies staff for follow-up.

### Chat & Command Infrastructure
- Slash-command loader/registrar (`src/bot/`) with Discord command registration.
- Conversational responder (DreamGen provider) with history trimming, context injection, and feature toggles.
- Express dashboard server (`src/dashboard/server.js`) serving the React app, REST APIs, and SSE event streams.

## Dashboard UI Map

### Shell & Navigation
- Persistent sidebar (logo, navigation groups, collapse-ready structure) and top bar with guild context/auth controls.
- Sticky toolbar with global period selector, search affordances, and focus mode toggles.
- Auth overlay for unauthenticated state; guild selector gate ensures context is loaded before routing.

### Moderation Page (`src/dashboard/client/src/pages/Moderation.jsx`)
- Configuration-focused workspace for filters, spam controls, escalation rules, alerts, support intake, and DM templates.
- Stats strip keeps last-updated automation metrics (warnings/timeouts/bans/cases) for quick health checks.
- Review & Save drawer summarizes diffs, highlights pending changes, and persists updates to `/api/moderation`.
- Case management now lives on the dedicated Cases page; Moderation no longer renders the inbox or timeline.

### Cases Page (`src/dashboard/client/src/pages/Cases.jsx`)
- Unified inbox backed by `/api/cases` with status/category/SLA filters, search, saved views, and "My queue" toggle.
- Deep links (`/cases/:id`) hydrate selection; legacy `/moderation/cases/:id` routes redirect automatically.
- Detail panel surfaces ownership, SLA badge, member metadata, complete action/message timeline, and reply composer.
- Live updates arrive via `/api/cases/events`; assignment, status, SLA, and DM actions call the `/api/cases/:id/*` endpoints.
- Quick actions bridge to moderation commands (warn/timeout/kick/ban) while recording results and refreshing the case.

### Other Screens
- Login page, Commands reference (`Commands.jsx`), Overview analytics, People roster, Insights, and Settings panels.

## Slash Commands

| Command | Scope & Permissions | Summary | Key Options |
| --- | --- | --- | --- |
| `/support` (`src/commands/support.js`) | DM/Server; no special perms | Guided ticket/case workflow (server or DM). | None |
| `/ping` (`src/commands/util/ping.js`) | Server | Measures bot/API latency. | None |
| `/tune` (`src/commands/util/tune.js`) | Server; Manage Guild recommended | Style/feature configuration wizard. | `feature`, `style`, `voice`, etc. |
| `/warn` (`src/commands/moderation/warn.js`) | Server; Moderate Members | Logs warning, DMs member, updates escalation ladder. | `target`, `reason` |
| `/timeout` (`src/commands/moderation/timeout.js`) | Server; Moderate Members | Applies timed timeout, logs action, updates case. | `target`, `duration`, `reason` |
| `/kick` (`src/commands/moderation/kick.js`) | Server; Kick Members | Removes member and records action. | `target`, `reason` |
| `/ban` (`src/commands/moderation/ban.js`) | Server; Ban Members | Bans member and stores audit trail. | `target`, `reason`, `delete_messages` |
| `/cases` (`src/commands/moderation/cases.js`) | Server; Moderate Members | Summarizes member case history. | `target` (optional) |

## Configuration & Data Files
- `data/moderation.json`: filter settings, spam limits, bypass scopes, raid-mode defaults, alerts, support intake channel, DM templates.
- `data/moderation/cases.json`: persisted case records, stats, audit entries, participant roster.
- `data/metrics/overview.json`: (optional) source for dashboard metrics; falls back to generated sample data when absent.
- `data/people/people.json`: roster, check-in cadences, and action history for the People workspace.

## Key UX Enhancements Implemented
- Sticky filters with responsive search and saved views across Cases and People tables.
- Collapsible case context, scroll masks, and attachment rendering in message feeds.
- Accessible focus outlines across interactive controls and consistent error/loading placeholder states.
- Keyboard-friendly navigation with visible focus, skip links, and ARIA labelling for key components.

Use this document as an entry point for onboarding contributors or drafting release notes around moderation and dashboard capabilities.
