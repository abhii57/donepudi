# PulseWire

A database-backed village community app: members can register with email and password or Google, share posts, react, and comment. Administrators can publish village highlights and manage tournaments. It uses SQLite at `data/pulsewire.sqlite` with a persistent Render disk in production.

## Run it

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `GOOGLE_CLIENT_ID`.
2. Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first start creates the schema. An admin account is created or updated from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; admin publishing stays unavailable until both are configured. The server verifies session tokens and admin roles before allowing announcements or tournament management. New members must capture a profile selfie during registration.

## Deploy to Render

The included `render.yaml` deploys the app as a Docker web service and mounts a persistent disk at `/app/data`, which retains the SQLite database between deploys. Push this project to a Git repository, then in Render choose **New → Blueprint** and select that repository. Render generates `JWT_SECRET` automatically. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `GOOGLE_CLIENT_ID` in the Render service environment. Add the Render service URL to the Google OAuth web client's authorized JavaScript origins. Account creation uses a captured profile selfie; password accounts use email and password, and Google ID tokens are verified on the server.
