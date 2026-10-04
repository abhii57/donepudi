# PulseWire

A real-time-style, database-backed news community: readers can register, log in, react to stories, and comment. Only users with the `admin` role can publish. It uses a local persistent SQLite database at `data/pulsewire.sqlite`, so no separate database service is required.

## Run it

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `MSG91_AUTHKEY`.
2. Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first start creates the schema. An admin account is created or updated from `ADMIN_EMAIL` and `ADMIN_PASSWORD`; publishing stays disabled until both are configured. The server verifies the user’s JWT and `role = admin` before accepting publishing and tournament management requests.

## Deploy to Render

The included `render.yaml` deploys the app as a Docker web service and mounts a persistent disk at `/app/data`, which retains the SQLite database between deploys. Push this project to a Git repository, then in Render choose **New → Blueprint** and select that repository. Render generates `JWT_SECRET` automatically. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `MSG91_AUTHKEY` in the new Render service's environment before relying on admin publishing or OTP signup. The OTP widget ID and browser token are configured in `public/app.js`.
