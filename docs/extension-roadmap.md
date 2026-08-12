# Built-in extension roadmap

GitHub established authenticated providers and rich components. Mermaid established local fenced-code
renderers. The next built-ins should broaden the extension contract rather than repeat one integration.

## Planned order

1. **Web bookmarks and link previews** — portable URL cards, cached Open Graph metadata, favicons,
   manual refresh, and a readable link fallback. This establishes a reusable metadata-fetch broker.
2. **Calendar / iCalendar** — attach calendars or events to notes, insert event summaries, and expose
   upcoming dates without turning Skald into a calendar client. This exercises time-based refresh and
   structured imports.
3. **GitLab** — reuse the repository-card contract while proving that providers can share UI and data
   types without pretending their authentication and API details are identical.
4. **Linear, then Jira if demand justifies it** — link projects and issues to notes through brokered,
   read-only providers first. Write actions should wait for explicit per-action permission prompts.
5. **Saved-query tables** — render Skald search results as native tables inside notes. This exercises
   scoped vault-read capability and reactive local data without any external service.

Installable third-party packages remain a separate security project: signing, compatibility checks,
explicit grants, revocation, and isolation must exist before downloaded code can join this list.
