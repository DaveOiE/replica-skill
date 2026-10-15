# TEST-ONLY image for trying the app on a home server (see replica/deploy/zimaos-test.md). Invented data only. Not the production setup:
# production runs under systemd behind Caddy over https (replica/deploy/README.md).
FROM node:22.22.0-bookworm-slim

ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/app.db \
    BACKUP_DEST=file:/data/backups \
    BACKUP_KEY_FILE=/data/backup-key \
    DEMO_CREDENTIALS_FILE=/data/demo-credentials.txt

WORKDIR /srv/taskapp

# Dependencies first (cached until the lock file changes). No dev dependencies, and no install scripts run.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Only what the app reads at run time. Tests, docs and design files stay out of the image.
COPY app/server ./app/server
COPY app/shared ./app/shared
COPY app/web ./app/web
COPY app/migrations ./app/migrations
COPY app/cli ./app/cli
COPY app/seed ./app/seed

# One writable folder, owned by the unprivileged user that ships with the Node image. The code itself stays owned by root.
RUN mkdir -p /data/backups && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "--no-warnings", "app/server/index.js"]
