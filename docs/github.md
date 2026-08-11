# GitHub repository cards

Skald notes can bind to one GitHub repository with portable frontmatter:

```yaml
---
schema: Project
github: vardirhq/skald
---
```

The editor property links to the repository. Insert a live card with:

```markdown
> [!github]
```

A bare card inherits the note's `github` property. A card can instead name another public
repository without changing the note binding:

```markdown
> [!github] electron/electron
```

Cards show repository metadata, open issues and pull requests, the latest release, and the
latest workflow run. Public repositories use GitHub's anonymous API and require no Skald or
GitHub account. Results are cached for ten minutes and use ETags; stale public data remains
available when GitHub is temporarily unreachable. Private repository data is kept in memory
only and is never written to the public-data cache.

## Configuring private repository access

Private access uses a GitHub App device flow. Create a dedicated GitHub App for Skald and:

1. Enable **Device Flow** under the app's optional features.
2. Give it read-only repository permissions for **Contents**, **Issues**, **Pull requests**,
   and **Actions**. GitHub grants the required **Metadata: read** permission automatically.
3. Do not subscribe to webhooks; repository cards poll only when displayed or refreshed.
4. Install the app only on the organizations and repositories Skald should be able to read.
5. Build or run Skald with the app's public client ID and slug:

   ```bash
   SKALD_GITHUB_CLIENT_ID=Iv1.example \
   SKALD_GITHUB_APP_SLUG=skald-desktop \
   npm run electron:dev
   ```

These values identify the app and are not secrets. Do not add a client secret to Skald.
Settings → GitHub opens GitHub's device authorization page and displays the one-time code.
The resulting user token never reaches the renderer: Electron's main process encrypts it
with the operating-system keyring via `safeStorage`. If protected storage is unavailable,
Skald refuses to connect rather than save a plaintext token. Disconnecting deletes it.

For a release build, supply the two variables while running the Electron main build. A build
without them continues to support all public repository cards and explains in Settings why
private sign-in is unavailable.
