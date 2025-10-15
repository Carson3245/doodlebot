# DoodleBot Overview

## Core Services

### Moderation Engine (`src/moderation/moderationEngine.js`)
- Initializes once per process, hot-reloads when `data/moderation.json` changes.
- Filters for links, invites, media, profanity, custom keywords and bypasses admins/mod roles/whitelisted scopes.
- Multi-signal anti-spam (messages, mentions, links, emojis, attachments) with auto-timeouts and full evidence capture.
- Escalation ladder: warns → timeout → ban based on configurable thresholds; automatically updates case status.
- Persists cases via `caseStore`; emits moderation logs/alerts and DM templates per action.

### Case Store (`src/moderation/caseStore.js`)
- Stores up to 500 cases in `data/moderation/cases.json` with stats/totals per user.
- Tracks actions, messages (with jump URL + attachment metadata), participants, audit log, unread counts.
- Supports open/update/append, status transitions, deletion, and event subscribers for live updates.

### Support Workflow (`src/support/supportWorkflow.js`)
- `/support` guided flow (guild or DM) with server/topic selection, modal for request details, and session TTL.
- Ensures/creates a case, posts intake embed to configured channel and notifies staff.

### Chat & Command Infrastructure
- Slash-command loader/registrar (`src/bot/`).
- Conversational responder with DreamGen provider, history trimming, context collection, and feature toggles.
- Express dashboard server (`src/dashboard/server.js`) serving React app + SSE updates.

## Dashboard UI Map

### Shell & Navigation
- Persistent sidebar (logo, navigation groups, collapse-ready structure).
- Topbar with guild context, auth actions, hamburger toggle for smaller layouts.
- Auth overlay for unauthenticated state.

### Moderation Page (`src/dashboard/client/src/pages/Moderation.jsx`)
- **Stats strip**: Automated bans/timeouts/kicks/warnings/cases with last-updated meta.
- **Case inbox**:
  - Sticky header with count, search (`Search cases…`), status/category filters, refresh.
  - Cards show subject, topic pill, unread badge, last update; search filters by subject/member/id/topic.
- **Conversation panel**:
  - Header: subject, opened-by/when, pills, toggle for detail block, case actions menu.
  - Collapsible detail block (member request, participants).
  - Message feed: metadata, “Open in Discord” link, attachments chips, scroll masks, new evidence fields.
  - Composer: compact textarea (2 rows), send button, disabled states tied to status/auth.
- **Quick actions/config panels** (lower column) collapsed by default but accessible for manual moderation workflows.

### Other Screens
- Login page, Commands reference (`Commands.jsx`), and configuration panels (filters, spam, escalation, alerts, templates) within the dashboard.

## Slash Commands

| Command | Scope & Permissions | Summary | Key Options |
| --- | --- | --- | --- |
| `/support` (`src/commands/support.js`) | DM/Server; no special perms | Launch guided ticket/case workflow, including DM flow. | None |
| `/ping` (`src/commands/util/ping.js`) | Server only | Measures bot/API latency. | None |
| `/tune` (`src/commands/util/tune.js`) | Server; Manage Guild recommended | Configuration wizard for style/chat features (persona, toggles, providers). | Subcommands for `feature`, `style`, `voice`, etc. |
| `/warn` (`src/commands/moderation/warn.js`) | Server; Moderate Members | Logs warning, DM’s member, updates case/escalation. | `target` (required), `reason` |
| `/timeout` (`…/timeout.js`) | Server; Moderate Members | Times out member for 1–10080 min, logs and escalates. | `target` (required), `duration` (required), `reason` |
| `/kick` (`…/kick.js`) | Server; Kick Members | Removes member and records action. | `target` (required), `reason` |
| `/ban` (`…/ban.js`) | Server; Ban Members | Bans member (fallback to guild.bans). | `target` (required), `reason`, optional `delete_messages` depending on implementation |
| `/cases` (`…/cases.js`) | Server; Moderate Members | Displays totals, last action, and sample active cases for member. | `target` (optional) |

## Configuration & Data Files
- `data/moderation.json`: filters, spam limits (multi-signal window), whitelists, raid-mode defaults, alerts, support intake channel, DM templates.
- `data/moderation/cases.json`: persisted case records, stats, audit trail.

## Key UX Enhancements Implemented
- Sticky filters with responsive search.
- Collapsible case context (auto for ≤1100px).
- Scroll masks and attachment rendering in message feed.
- Accessible focus outlines across buttons/links/forms.

Use this document as the entry point for onboarding contributors or drafting release notes around moderation and dashboard capabilities.
