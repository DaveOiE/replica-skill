# Trying the app on a home server (ZimaOS), test only

**Read this first.**

- **Invented data only.** This setup is for trying the app with made-up people and tasks. Do not put real client data, real names or real passwords in it.
- **Not production.** It runs in non-production mode over plain **http**. The app refuses to run in production mode without an **https** address, and this setup does not have one.
- **Not the production pieces.** The systemd units, Caddy, the firewall rules, the two-user split, the credential files and Google Cloud Storage from the rest of `replica/deploy/` are **not exercised** by this setup. Passing here proves nothing about them.
- **Do not expose it to the internet.** No port forwarding, no public DNS name, no "open to the world" setting on your router. If you want to reach it from outside your home, use a tunnel or VPN you already trust (for example the one your server software offers) and keep the app itself on your home network only.
- The app is not certified to any standard and has not been penetration tested. Nothing was run on a real ZimaOS machine when this was written: the files were checked by tests, not by Docker on a server (the build test runs only where Docker is available).

## What you get

- `Dockerfile` (repository root): Node 22.22.0, an unprivileged user, production dependencies only, no install scripts.
- `docker-compose.yml` (repository root): one service, one named volume `taskapp-test-data` holding the database and the backups, a health check, a read-only container file system, no extra privileges. Port 3000 is published on **one LAN address**, not on every address.
- The app runs with `NODE_ENV=development` and `PUBLIC_URL=http://<your LAN address>:3000`.

## Run it from a terminal

You need Docker with the compose plugin, and a copy of this repository on the server.

1. Find the server's address on your home network (for example `192.0.2.50`; yours will differ). Give the router's DHCP list a fixed address for the server so it does not change.
2. Copy `replica/deploy/zimaos-test.env.example` to a file **outside the repository** (for example `~/taskapp-test.env`) and put the address in it. The app refuses to start while the placeholder is still there.
3. From the repository root:
   ```
   docker compose --env-file ~/taskapp-test.env up -d --build
   docker compose --env-file ~/taskapp-test.env ps          # wait for "healthy"
   ```
4. **Fake data.** Make the demo database and read the made-up sign-ins:
   ```
   docker compose --env-file ~/taskapp-test.env exec app node --no-warnings app/seed/seed.js --force
   docker compose --env-file ~/taskapp-test.env exec app cat /data/demo-credentials.txt
   docker compose --env-file ~/taskapp-test.env restart app
   ```
   The seed deletes the database it points at, which is why it needs `--force`. The passwords are random and fake; they change every time you seed. Open `http://<your LAN address>:3000` from another device on the same network.
5. **Or start empty with your own first owner** (instead of step 4, on an empty volume; it refuses when any owner already exists, demo data included):
   ```
   docker compose --env-file ~/taskapp-test.env exec app node --no-warnings app/cli/first-owner.js --workspace "Test Co" --name "Test Owner" --email owner@example.test
   ```
   The password is shown once, in the terminal. It needs a real terminal, which `exec` provides. Use an invented name and an `example.test` address.
6. **Backups.** Make a key once, inside the volume (this is test data; a real key never lives next to the data), then take and list a backup:
   ```
   docker compose --env-file ~/taskapp-test.env exec app sh -c 'umask 077; node --no-warnings app/cli/backup.js keygen --allow-non-tty | grep -E "^[0-9a-f]{64}$" > /data/backup-key'
   docker compose --env-file ~/taskapp-test.env exec app node --no-warnings app/cli/backup.js backup --kind manual
   docker compose --env-file ~/taskapp-test.env exec app node --no-warnings app/cli/backup.js list
   ```
   Backups land in `/data/backups` on the same volume, so they do **not** protect you from losing the volume. To copy them off, use `docker cp` (or your server's file manager) and keep them somewhere else.
7. **Restore** into a scratch file first, with the app stopped for a real restore:
   ```
   docker compose --env-file ~/taskapp-test.env exec app node --no-warnings app/cli/backup.js restore --from <backup name> --to /tmp/check.db
   ```
   It shows what the backup is and asks you to type its name. A real restore adds `--replace` and the target `/data/app.db`.
8. Stop and clean up: `docker compose --env-file ~/taskapp-test.env down` keeps the data; add `-v` to delete the volume and everything in it.

## Import into ZimaOS as a custom app

ZimaOS can import a compose file as a custom app. The exact buttons change between versions, so follow what the screen shows; these are the steps that matter.

1. Build the image on the server first (step 3 above), so the image `taskapp-test:local` exists there. ZimaOS's importer reads a compose file; it does not build from a repository for you.
2. In ZimaOS, open the App Store, choose **Custom Install** (the plus button), then **Import** and paste the contents of `docker-compose.yml`.
3. Replace the two `${LAN_IP...}` placeholders with your server's address as plain text (the importer may not fill in variables), and remove the `build: .` line so it uses the image you built. Do not change anything else.
4. Check, before you click install: the port is `<your address>:3000:3000` (not `3000:3000`, which would offer it on every network), the environment shows `NODE_ENV: development`, and there is one volume.
5. Install, wait for the app to show healthy, then run the seed (step 4 above) from the app's terminal or from an SSH session using `docker exec`. Open the address from a device on your home network.

## If it does not work

- The container keeps restarting: `docker compose logs app`. A message saying a setting "still holds a placeholder" means the address was not filled in.
- You cannot reach it from another device: check the address, that the server and device are on the same network, and that the server's own firewall allows port 3000 from your home network only.
- Sign-in works but pages act oddly: use exactly the address in `PUBLIC_URL` in the browser. A different name or address for the same server is treated as a different site.
- "Run this in a terminal": the first-owner and key commands show a secret once, so they refuse to run without one. Use `exec` without `-T`.
