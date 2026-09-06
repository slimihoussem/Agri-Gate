# Vercel deployment

Use two Vercel projects from this repository: one Next.js frontend project and
one Express API project. Supabase remains the database. This avoids mixing two
Vercel frameworks in one project.

## 1. Deploy the frontend to Vercel

1. Open Vercel and choose **Add New -> Project**.
2. Import `slimihoussem/Agri-Gate` from GitHub.
3. Vercel detects Next.js from `vercel.json`.
4. Add this environment variable:

```env
NEXT_PUBLIC_API_URL=https://your-api-project.vercel.app
```

5. Deploy. Vercel provides the frontend URL.

Do not add `DATABASE_URL` or `JWT_SECRET` to the frontend project.

The value of `NEXT_PUBLIC_API_URL` must be the API project's final Vercel URL.
Test the API directly:

```text
https://your-api-project.vercel.app/api/health
```

Expected response:

```json
{"status":"ok","service":"agrigate-api"}
```

## 2. Deploy the Express API to a second Vercel project

Create another Vercel project from the same GitHub repository. In the project
settings, set **Framework Preset** to **Express** (or override automatic
detection to Express). The repository exports the app from `src/server.ts`,
which Vercel recognizes as the Express entrypoint.

Add these environment variables to the API project:

```env
DATABASE_URL=your_supabase_pooler_connection_string
JWT_SECRET=your_new_random_secret
NODE_ENV=production
```

Deploy and test `/api/health`. Then copy the API project's URL into the
frontend project's `NEXT_PUBLIC_API_URL` and redeploy the frontend.

## 3. Optional: Oracle Cloud VM for MQTT

Create an Ubuntu VM in Oracle Cloud Always Free. Add ingress rules for TCP ports `22`, `80`, and `443`. Do not expose PostgreSQL or the internal MQTT listener publicly.

Install Docker and Caddy on the VM, then clone the repository:

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin caddy
sudo systemctl enable --now docker caddy
git clone https://github.com/slimihoussem/Agri-Gate.git
cd Agri-Gate
```

Create `.env.oracle` on the VM. Never commit it:

```env
DATABASE_URL=your_supabase_pooler_connection_string
JWT_SECRET=your_new_random_secret
NODE_ENV=production
```

The repository includes `.env.oracle.example` as a template. Copy it to
`.env.oracle` on the VM and replace the placeholders with real values.

Start the API, worker, and private MQTT broker:

```bash
sudo docker compose -f docker-compose.oracle.yml up -d --build
sudo docker compose -f docker-compose.oracle.yml ps
```

## 4. Add HTTPS for an optional Oracle API

Point `api.your-domain.com` DNS A record to the Oracle VM public IP. Replace `api.example.com` in `Caddyfile` with that hostname:

```bash
sudo cp Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy automatically requests and renews the HTTPS certificate. Test the API:

```bash
curl https://api.your-domain.com/api/health
```

Expected response:

```json
{"status":"ok","service":"agrigate-api"}
```

## 5. Update Vercel

If you later move the API to Oracle, change the frontend's
`NEXT_PUBLIC_API_URL` to the Oracle HTTPS API URL and redeploy Vercel.

## 5. Database migrations

The Supabase schema and seed data are already created. Do not run `npm run db:reset` on Supabase. For future migrations, run them from the Oracle VM or a controlled local machine using the Supabase pooler URL:

```bash
npm run migrate:up
```

## 6. MQTT warning

The included Mosquitto configuration is for development and allows anonymous access. The Oracle compose setup keeps it private, which is suitable for the API/worker connection. Do not expose port `1883` to the internet or connect field devices to it until MQTT authentication, TLS, and per-device ACLs are configured.
