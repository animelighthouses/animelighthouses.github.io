Anime Lighthouse Index — documentation index
=============================================

This folder is the narrative and reference layer for the project. Files are intentionally
split so each answers one kind of question; avoid duplicating paragraphs across files —
update one source of truth.

| File               | Purpose |
|--------------------|---------|
| SITUATION.txt      | Short origin story — why building this. |
| PRD.txt            | Product framing: problem, audiences, goals, scope, constraints. |
| FEATURES.txt       | What the shipped app actually does (routes, UX, integrations). |
| ARCHITECTURE.txt   | Module layers, dependency graph, partials workflow. |
| ENHANCEMENTS.txt   | Ideas and backlog — not shipped. |
| SCHEMA.txt         | Supabase Postgres shape, enums, RLS summary. |
| SUPABASE_OPS.txt   | Edge Function secrets, deploy, webhooks. |
| README.txt         | This index. |

Suggested reading order for someone new: SITUATION → PRD → FEATURES → ARCHITECTURE
(if changing code) → SCHEMA (if touching data).

Root README.md stays minimal repo identity only.
