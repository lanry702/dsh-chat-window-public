# Privacy Policy — dsh-gdrive

Last updated: 2026-11-24

`dsh-gdrive` is a local plugin for DeepSeek Harness (DSH). It is not a hosted service:
the program runs on the user's own computer, and the OAuth client used to sign in belongs
to the user's own Google Cloud project.

## What this app accesses

When the user completes Google's consent screen, the app receives an OAuth refresh token
for the scopes shown on that screen — in the default configuration:

- `https://www.googleapis.com/auth/drive` — see, edit, create and delete the user's Google Drive files
- `https://www.googleapis.com/auth/userinfo.email` — read the signed-in account's email address
- `openid`

The email scope is used for one thing: showing which account is authorized (`whoami`).

## Where data is stored

All data stays on the user's computer:

- `%DSH_HOME%\gdrive\token.json` — the OAuth refresh and access tokens (file permission 0600)
- `%DSH_HOME%\gdrive\cache\` — files downloaded on request, so local tools can read them
- `%DSH_HOME%\gdrive\gdrive.log` — diagnostic log of tool calls

## What is transmitted

Requests go only to Google's own API endpoints (`oauth2.googleapis.com`,
`www.googleapis.com`, `accounts.google.com`). There is no server operated by this project,
no analytics, no telemetry, and no third party receives the tokens or any file content.

## Who can see the data

Only whoever can read the local files listed above, plus Google (through its own APIs).
Nothing is shared with the author of this plugin.

## Revoking access

- Locally: delete `%DSH_HOME%\gdrive\token.json`, and remove the plugin from the DSH profile.
- Remotely: open <https://myaccount.google.com/permissions> and remove access for this app.

After revocation the tokens stop working immediately; the app can no longer read or modify
the user's Drive.

## Children

This app is a personal development tool and is not directed at children.

## Contact

lanry702@gmail.com
