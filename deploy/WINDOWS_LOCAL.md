# Run locally on Windows

The [PowerShell launcher](../scripts/start-local.ps1) sets up and runs:

| Service | Local address |
| --- | --- |
| Frontend | http://127.0.0.1:5173 |
| API | http://127.0.0.1:3000/api/health |
| PostgreSQL | `127.0.0.1:5433`, database/user `boi_union` |

Everything runs in Linux containers using [compose.local.yaml](../compose.local.yaml).
You do not need to install Node.js, npm or PostgreSQL on Windows. The services bind
only to the local computer, not the LAN. This is a local development setup, not an
internet-facing production deployment.

## 1. Install prerequisites

Use a supported Windows 10/11 system with virtualization enabled and WSL 2.
Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
and, if cloning the repository, [Git for Windows](https://git-scm.com/downloads/win).
Follow Docker's installation instructions, including any WSL setup and required reboot.

Alternatively, install these applications from PowerShell using Windows Package Manager:

```powershell
winget install --exact --id Docker.DockerDesktop
winget install --exact --id Git.Git
```

Start Docker Desktop, select **Linux containers** / the WSL 2 engine, and wait until
the engine is running. Use an up-to-date Docker Desktop with Docker Compose v2
(2.20 or newer). Reopen PowerShell after installation.

Internet access is needed on the first run to download container images and npm dependencies.

## 2. Get the project

```powershell
git clone https://github.com/pbakliwal/boi-union.git
cd boi-union
```

If you already copied or downloaded the project, open PowerShell in its root folder
(the folder containing `package.json`). The checkout must include the launcher and
Docker files linked above. Private repositories require your own GitHub access.

## 3. Set up and start everything

From the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

The execution-policy override applies only to this PowerShell process; it does not
change the machine's permanent policy. If your organization disallows scripts or
Docker, follow its policy rather than bypassing those restrictions.

The launcher:

1. Checks Docker Desktop and Docker Compose.
2. Creates `.env.local` with cryptographically random database, session and admin
   secrets, **only if the file does not exist**. Your existing `.env` is not read or changed.
3. Builds the application image and starts PostgreSQL with persistent storage.
4. Applies database migrations and creates the initial admin account and placeholder
   categories using the existing `npm run setup` command.
5. Starts the API and frontend and waits for their health checks, including the API proxy.

Open **http://127.0.0.1:5173**. To see the generated login credentials locally:

```powershell
notepad .\.env.local
```

Sign in with `LOCAL_ADMIN_USER` (initially `admin`) and `LOCAL_ADMIN_PASSWORD`.
Treat `.env.local` as a secret. It is ignored by Git and excluded from Docker builds.
Never commit it or share it in screenshots or logs.

This creates a **new local database**. It does not copy data or accounts from another
computer. The setup command creates two placeholder categories; rename them and add
rates in the app, or import your complete zone register with its `DISTRICT` column.

## 4. Stop, restart and inspect services

```powershell
# Stop containers and remove their network; KEEP database data and credentials.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Action Stop

# Start again; migrations/setup are safe to rerun and existing accounts are unchanged.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1

# Show status.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Action Status

# Follow logs. Ctrl+C exits the log viewer, not the running services.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Action Logs
```

Services continue running when PowerShell closes. Docker Desktop must remain running.
After a Windows reboot, start Docker Desktop and rerun the launcher if necessary.

Source code is copied into the container image, not mounted from Windows. After pulling
code updates, run **Stop**, then run the launcher again to rebuild and restart.
The same checkout can still use the manual non-Docker setup in the
[README](../README.md); its Vite proxy continues to default to `localhost:3000`.

## Data and credential safety

- Database files live in the Docker volume `boi-union-local_postgres-data`.
  Stopping containers does not delete it.
- Do **not** delete `.env.local`, remove the Docker volume, or use Compose's
  `down --volumes` option unless you intentionally want to reset the installation.
  Keep `.env.local` alongside the database: regenerating it does not change an
  existing PostgreSQL user's password and would prevent the API from connecting.
- Changing `LOCAL_ADMIN_PASSWORD` in the file does not reset an existing admin
  account. Use the app's **Users** screen to manage passwords.
- Leave the generated database password in its URL-safe hexadecimal format.
  The API connection URI embeds it directly.
- The container database is separate from any PostgreSQL installation on your
  computer. Port 5433 is used to avoid the usual native PostgreSQL port 5432.
- Back up important data before updating the project or Docker Desktop.

### Create a database backup

With the services running, from the project root:

```powershell
New-Item -ItemType Directory -Force .\backups | Out-Null
$backup = "boi-union-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
docker compose --env-file .env.local -f compose.local.yaml exec -T db pg_dump -U boi_union -d boi_union -Fc -f /tmp/boi-union.dump
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
docker compose --env-file .env.local -f compose.local.yaml cp db:/tmp/boi-union.dump ".\backups\$backup"
if ($LASTEXITCODE -ne 0) { throw 'Copying the database backup failed.' }
```

The custom-format PostgreSQL backup is saved under `backups/`, which is ignored by
Git and excluded from Docker builds. Store a protected copy off this computer;
it contains application data and password hashes.

## Troubleshooting

- **Docker cannot connect / engine not ready:** start Docker Desktop and wait for
  it to finish starting. Switch to Linux containers if prompted by the launcher.
- **Port already in use:** stop the application already using ports 3000, 5173 or
  5433, then retry. Do not start the manual npm servers alongside this setup.
- **Image build/download fails:** check your internet connection, available disk
  space, proxy and Docker Desktop settings. The script exits with an error; retry
  once the underlying issue is resolved.
- **A service is unhealthy:** run `-Action Status` and `-Action Logs`. Startup may
  leave containers running after a failure; use `-Action Stop` before retrying.
  Migration or setup failures are reported in the API logs.
- **Database authentication fails after editing/deleting `.env.local`:** restore
  the original file from your protected copy. Do not delete the data volume to fix
  a credential mismatch if you need to keep its data.
- **Wrong admin password:** use the password from the first setup, or ask another
  admin to reset it in **Users**. Rerunning setup does not overwrite accounts.
