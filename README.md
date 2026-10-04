# PulseWire

A database-backed village community app: members can register with email and password, then view posts, react, and comment after logging in. Administrators can publish village highlights and manage tournaments. It uses SQLite at `data/pulsewire.sqlite` with a persistent Render disk in production.

## Run it

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
2. Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first start creates the schema. An admin account is created or updated from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; admin publishing stays unavailable until both are configured. The server verifies session tokens and admin roles before allowing announcements or tournament management. Members sign up with their name, email, and password. Post feeds require a valid login.

## Deploy to Render

The included `render.yaml` deploys the app as a Docker web service and mounts a persistent disk at `/app/data`, which retains the SQLite database between deploys. Push this project to a Git repository, then in Render choose **New → Blueprint** and select that repository. Render generates `JWT_SECRET` automatically. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the Render service environment. The public health endpoint is `/api/health`; community posts are available only to logged-in members.
