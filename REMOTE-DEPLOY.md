# OmniSync Remote Shared Deployment

## Best Current Path

For remote coworker testing with shared data, the best near-term option is:

- deploy the Node app online
- mount persistent storage for `cloud-db.json`
- share the public URL

Because OmniSync now uses a backend JSON database file, the host must support persistent storage.

## Recommended Host: Railway

Railway is a good fit for the current app because:

- it can host the Node service directly
- it supports persistent volumes
- it gives you a public URL quickly

Official reference:

- [Railway volumes](https://docs.railway.com/deploy/volumes)

Important detail from Railway docs:

- if your app writes to `./data`, mount the volume to `/app/data`

## Files Already Prepared

- `Server.js`
- `package.json`
- `Dockerfile`
- `.dockerignore`

The server now supports:

- `PORT`
- `OMNISYNC_DATA_DIR`

For Railway, use:

- `OMNISYNC_DATA_DIR=/app/data`

## Railway Deployment Steps

1. Push `C:\OmniSync` to GitHub
2. Create a new Railway project from that repo
3. Add a volume to the service
4. Mount the volume at:
   - `/app/data`
5. Add environment variable:
   - `OMNISYNC_DATA_DIR=/app/data`
6. Deploy
7. Open the generated public Railway URL
8. Log in with:
   - `admin@fowlerprecision` / `password`
   - `op1@fowlerprecision` / `password`

## What Coworkers Will Get

With this deployment:

- coworkers can open the public link remotely
- everyone uses the same backend data
- plans, runs, FAI, NCR, settings, and shared state are visible to all users in the same org

## Current Limitations

This is a real shared backend, but still an early cloud version:

- file-based database, not PostgreSQL yet
- simple password auth
- no password reset
- no file/object storage service yet
- no multi-org admin console yet

## Strong Next Upgrade After Remote Testing

After coworkers validate the concept, the next production-grade step should be:

1. PostgreSQL for structured shared data
2. object storage for drawings and report assets
3. proper auth provider
4. invite-based user management
5. audited approval workflow

## Alternative Hosts

These can also work if you prefer them:

- [Fly.io volumes](https://fly.io/docs/volumes/overview/)
- Render with persistent disk

But for the current stage, Railway is probably the fastest path to a usable public demo with shared storage.

## Important Note

I can prepare the app and deployment files, but I cannot actually publish it from here without your cloud account / repo access.

