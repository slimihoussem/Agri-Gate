# Supabase deployment

AgriGate uses its own Express/JWT authentication, so Supabase is used as the managed PostgreSQL database. Supabase Auth is not required for the current application.

## 1. Create and share the Supabase project

1. Create a Supabase project.
2. In **Project Settings -> Database**, copy both connection strings:
   - **Direct/session URL**: port `5432`, for migrations.
   - **Transaction pooler URL**: port `6543`, for the deployed API and MQTT worker.
3. Invite teammates from **Project Settings -> Team**. Grant only the access each teammate needs.
4. Keep the database password and service credentials in the hosting providers' secret stores. Do not commit them to `.env` or source control.

## 2. Create the schema and seed data

From the repository root, use the direct/session URL temporarily:

```powershell
$env:DATABASE_URL = "postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres"
npm ci
npm run migrate:up
npm run seed
```

Migration 001 skips TimescaleDB when the extension is unavailable. Migration 002 then creates a native PostgreSQL `telemetry_hourly` view with the same columns used by the API. The local Docker TimescaleDB path remains unchanged.

Run a quick check:

```powershell
npm run db:verify
```

Do not run `npm run db:reset` against a shared Supabase project. It drops the public schema.

## 3. Deploy the API and MQTT worker

The Next.js frontend cannot host the long-running Express API or MQTT subscriber. Deploy these as separate services on Render, Railway, Fly.io, or an equivalent Node host.

API service:

- Build: `npm ci`
- Start: `npm run server:start`
- Health check: `/api/health`
- Environment:
  - `DATABASE_URL`: Supabase transaction pooler URL, port `6543`
  - `JWT_SECRET`: a new random production secret
  - `NODE_ENV`: `production`
  - `API_PORT`: supplied by the host, or `4000`

MQTT worker:

- Build: `npm ci`
- Start: `npm run mqtt:start`
- Environment:
  - `DATABASE_URL`: the same Supabase transaction pooler URL
  - `MQTT_BROKER_URL`: a hosted MQTT broker URL, not `localhost`

The local Mosquitto container is for development only. A hosted MQTT broker is required for real field-node telemetry.

## 4. Deploy the Next.js frontend

Deploy the repository to Vercel or another Next.js host:

- Build: `npm run build`
- Start: `npm run start`
- Environment:
  - `NEXT_PUBLIC_API_URL=https://<your-api-host>`

The API must allow the frontend origin and both services must use HTTPS. Production authentication cookies are configured as secure cross-site cookies. After deployment, verify login, `/api/health`, dashboard loading, and one authenticated mutation.

## 5. Team workflow

- Store the repository in a shared GitHub organization/repository.
- Store production secrets only in Supabase, Vercel, and the API/worker host secret managers.
- Use separate Supabase projects for development, staging, and production when possible.
- Run migrations once per environment from a controlled deployment job or an authorized maintainer machine.
- Use Supabase database backups before schema changes and never use `db:reset` on staging or production.
