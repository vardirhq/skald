// GitHub App client ids and slugs are public identifiers, not secrets. Set the
// environment variables in development/builds until the Vardir GitHub App has
// been registered, then its stable values can replace the empty defaults.
export const GITHUB_CLIENT_ID = process.env['SKALD_GITHUB_CLIENT_ID']?.trim() || '';
export const GITHUB_APP_SLUG = process.env['SKALD_GITHUB_APP_SLUG']?.trim() || '';
