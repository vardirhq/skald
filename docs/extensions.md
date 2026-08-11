# Built-in extensions

Skald extensions are a versioned contribution system for features that cross more than one
surface. GitHub is the first extension: it contributes the `[!github]` Markdown component,
the `github` note property, an editor insertion action, a Settings pane, and authenticated
main-process providers.

This first version is intentionally **not** a marketplace or an arbitrary JavaScript loader.
Extensions ship with Skald, are reviewed with the application, and are registered at startup.
That establishes a stable contract without allowing downloaded code to execute with vault or
desktop privileges.

## Portable component contract

Components use ordinary callout Markdown:

```markdown
> [!github] vardirhq/skald
```

An extension may inherit a value from frontmatter, but the source remains comprehensible and
editable in every Markdown application. If a Skald client does not have a matching renderer,
the existing generic callout renderer handles it. Unknown components are never deleted or
rewritten merely because an extension is unavailable.

Desktop and Android share the extension id, component type, property key, normalization rules,
and fallback expectations. They may render different amounts of information: desktop GitHub
cards fetch live data, while Android currently renders a native repository link card.

## Desktop contributions

Renderer extensions are registered in `src/extensions/registry.ts`. The contract in
`src/extensions/types.ts` supports:

- Markdown component renderers;
- typed note properties with normalization and editor dialogs;
- editor insertion actions, optionally requiring a property;
- Settings panes.

Main-process provider contracts live in `src-main/extensionRegistry.ts` and built-ins are
registered in `src-main/extensions.ts`. This keeps
network clients, authentication state, and secure credentials outside the renderer. The two
sides use the same serializable manifest from `src-shared/extensions.ts`.

Every manifest declares a stable reverse-domain id, semantic version, supported platforms, and
capabilities per platform. Registration fails on duplicate ids, component types, properties, actions, panes,
or IPC channels. An extension therefore cannot silently replace an earlier contribution based
on import order.

## Adding a built-in extension

1. Add a serializable manifest and declare only the capabilities the feature actually uses.
2. Add renderer contributions as one `RendererExtension` and register it in the built-in list.
3. Put authenticated or privileged work behind a main-process contribution; never pass secrets
   through IPC.
4. Add the same component identity and an honest fallback to mobile before notes can create the
   component there.
5. Test normalization, registry collisions, unknown-component fallback, and platform builds.

## Future third-party packages

The manifest and registry are groundwork, not permission to load arbitrary packages. External
extensions would additionally need package signing, explicit user consent, capability grants,
version compatibility, revocation, and process or worker isolation. Vault and network access
must be brokered APIs rather than direct Node or filesystem access. Until those boundaries exist,
only built-in extensions are accepted.
