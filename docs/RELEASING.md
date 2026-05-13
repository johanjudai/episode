# Releasing — maintainer notes

This file is for whoever maintains the repo. Users don't need it.

## Cutting a release

A push of a `v*` tag triggers `.github/workflows/release-apk.yml`, which builds the static SPA, syncs Capacitor, gradle-builds the APK, and uploads it as an asset on the matching GitHub Release with auto-generated notes.

```bash
git tag v0.2.0
git push --tags
```

The Release page (e.g. `releases/tag/v0.2.0`) then exposes `episode-v0.2.0.apk` for download. The workflow can also be triggered manually from the **Actions** tab — that path drops the APK as a 30-day workflow artifact instead of creating a release.

## Signing the APK (one-time setup)

Without a keystore the workflow falls back to a **debug**-signed APK that still sideloads but shows the _"Install unknown apps"_ warning on Android. To produce a proper **release**-signed APK that installs cleanly and can be published to Play Store / F-Droid, generate a keystore once and add four secrets to the repo.

> **The keystore is irreplaceable.** Back it up forever (password manager + offline encrypted copy). Losing it means you can no longer push updates that install over the existing app — every user would have to uninstall + reinstall.

### 1. Generate a 4096-bit RSA keystore locally

Windows PowerShell — `keytool` ships with the JDK:

```powershell
keytool -genkey -v `
  -keystore episode.keystore `
  -alias episode `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000
```

It prompts for:

- A **keystore password** (store it in your password manager).
- A **key password** (press Enter to reuse the keystore one — simpler).
- Identity fields (name, organisation, locality). Fill anything that makes sense; it ends up in the cert metadata.

### 2. Encode the keystore as base64 for the GitHub secret

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("episode.keystore")) `
  | Set-Clipboard
```

The base64 blob is now in your clipboard. **Clear the clipboard once pasted** (`Set-Clipboard -Value ' '`) — clipboard managers can persist it otherwise.

### 3. Add four secrets to the repo

<https://github.com/johanjudai/episode/settings/secrets/actions> → _Repository secrets → New repository secret_:

| Secret name                 | Value                                                    |
| --------------------------- | -------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | paste the clipboard from step 2                          |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password from step 1                        |
| `ANDROID_KEY_ALIAS`         | `episode` (matches `-alias` above)                       |
| `ANDROID_KEY_PASSWORD`      | the key password (same as keystore if you pressed Enter) |

### 4. Move the keystore off your dev machine

After the secrets are saved on GitHub, copy `episode.keystore` to your offline backup (encrypted password manager, hardware token, encrypted USB key — pick one). Do **not** commit it to the repo. Do **not** delete it.

### 5. Push a tag

The next `release-apk` run picks up the secrets, decodes the keystore, and produces `app-release.apk` instead of `app-debug.apk`. The Release notes will read _"✅ Release-signed"_ instead of _"⚠️ Debug-signed"_.

```bash
git tag v1.0.0
git push --tags
```

You can also test the signing flow first via _Actions → release-apk → Run workflow_ — that drops the signed APK as a workflow artifact (30-day retention) without creating a public Release.

## Security model — how the secrets stay safe

GitHub Secrets is designed exactly for this use case:

- **Encrypted at rest** — stored using libsodium sealed boxes. The Settings UI never displays values back; only the names are visible.
- **Decrypted only on the runner** — injected into the workflow job as masked env vars, valid for the lifetime of the run (the runner VM is destroyed afterwards).
- **Auto-masked in logs** — any value that appears in command output is replaced with `***`. Even an accidental `echo $KEY_PASSWORD` would not leak.
- **Not exposed to forks** — workflows triggered from pull requests opened against the repo from a fork run _without_ secrets. So an attacker forking the project + opening a PR with a modified workflow that tries to dump them gets nothing.
- **Tag-push workflow only the maintainer can trigger** — `push: tags: ['v*']` requires write access on the repo. Same for `workflow_dispatch`.

The release workflow passes the three password values to gradle via **environment variables** (not command-line args). This keeps them out of the process arg list on the runner, while GitHub's log masking covers the env-var contents anyway.

## Rotating the keystore (you really don't want to)

If you suspect the keystore is compromised, or you genuinely lost the file:

- Old installs on user devices will become **orphaned**: they can be updated only after the user uninstalls + reinstalls the new version. There is no migration path.
- Generate a new keystore as above, bump the secrets, and tag a new major version. Communicate the uninstall + reinstall requirement to users via the Release notes.

Best to never need this. Keep the keystore safe.
