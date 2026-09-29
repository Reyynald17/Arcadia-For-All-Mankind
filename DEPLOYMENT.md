# AFM — Deployment Guide

## 🚀 Frontend Deployment (Vercel)

### Step 1: Push to GitHub

```bash
git add .
git commit -m "Deploy AFM MVP"
git push origin mvp-complete
```

### Step 2: Deploy to Vercel

```bash
cd frontend
npm install -g vercel
vercel deploy
```

### Step 3: Configure Environment

In Vercel dashboard:
1. Go to Settings → Environment Variables
2. Add `VITE_API_URL=<backend-url>`
3. Redeploy

---

## 🔧 Backend Deployment (Railway)

### Step 1: Create Railway Account

Go to https://railway.app and sign up

### Step 2: Create New Project

```bash
npm install -g @railway/cli
railway login
cd backend
railway init
```

### Step 3: Configure Environment

Add to Railway:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `NODE_ENV=production`

### Step 4: Deploy

```bash
railway deploy
```

### Alternative: Render

```bash
# Create account at render.com
# Connect GitHub repo
# Deploy from dashboard
```

---

## 🗄️ Database (Supabase)

### Step 1: Create Project

Go to https://supabase.com and create a new project

### Step 2: Get Credentials

1. Project Settings → API
2. Copy:
   - Project URL
   - Service Role Key
   - Anon Key

### Step 3: Run Schema

1. Go to SQL Editor
2. Paste contents of `supabase/schema.sql`
3. Run query

### Step 4: Seed Initial Data

Run this SQL in Supabase:

```sql
INSERT INTO technologies (name, era, research_cost_ap, research_cost_budget, duration_days, prerequisite) VALUES
('Liquid Propulsion', '1969-1975', 10, 20, 14, '{}'),
('Guidance System', '1969-1975', 12, 25, 21, '{"Liquid Propulsion"}'),
('Orbital Rocket', '1969-1975', 15, 40, 30, '{"Liquid Propulsion", "Guidance System"}'),
('Satellite', '1969-1975', 8, 15, 14, '{"Orbital Rocket"}'),
('Crew Capsule', '1969-1975', 20, 50, 45, '{"Orbital Rocket"}'),
('Lunar Orbit', '1975-1985', 25, 60, 60, '{"Crew Capsule", "Guidance System"}'),
('Lunar Landing', '1975-1985', 35, 80, 90, '{"Lunar Orbit"}');

INSERT INTO npcs (name, archetype, ap, budget, rp, si, ipi, slr, strategy) VALUES
('NPC-Alpha', 'Lunar First', 25, 50, 0, 70, 60, 0, '{"priority": ["orbital", "lunar"]}'::jsonb),
('NPC-Beta', 'Safe & Steady', 25, 50, 0, 70, 60, 0, '{"priority": ["satellite", "probe"]}'::jsonb),
('NPC-Gamma', 'Space Pioneer', 25, 50, 0, 70, 60, 0, '{"priority": ["manned", "lunar"]}'::jsonb);
```

---

## 🌍 Environment Variables

### Vercel (Frontend)

```env
VITE_API_URL=<railway-backend-url>
VITE_SUPABASE_URL=<supabase-url>
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### Railway (Backend)

```env
SUPABASE_URL=<supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_ANON_KEY=<anon-key>
NODE_ENV=production
PORT=8787
```

### Supabase

No configuration needed — fully managed.

---

## 📊 Monitoring

### Vercel
- Logs: Vercel dashboard → Function logs
- Analytics: Vercel dashboard → Analytics

### Railway
- Logs: Railway dashboard → Project logs
- Metrics: Railway dashboard → Deployments

### Supabase
- Database: Supabase dashboard → SQL Editor
- Logs: Supabase dashboard → Logs
- Stats: Supabase dashboard → Database Overview

---

## 📈 Scaling

With free tier:
- ✅ Up to 50 concurrent users
- ✅ 500MB database storage
- ✅ 5GB bandwidth/month (Railway)

If you exceed limits, upgrade to paid plans (affordable).

---

## ✅ Deployment Checklist

- [ ] Create Supabase project
- [ ] Run schema.sql in Supabase
- [ ] Seed initial data
- [ ] Get Supabase credentials
- [ ] Deploy backend to Railway
- [ ] Deploy frontend to Vercel
- [ ] Configure environment variables
- [ ] Test all endpoints
- [ ] Verify database connections
- [ ] Set up monitoring

---

## 🔒 Security Notes

⚠️ **NEVER commit `.env` files**
- Add `.env` to `.gitignore`
- Use `env.example` for templates
- Store secrets in deployment platform only

⚠️ **Use Service Role Key securely**
- Only on backend (never frontend)
- Rotate regularly
- Store in secure vault

⚠️ **Enable SSL/TLS**
- Vercel: Automatic
- Railway: Automatic
- Supabase: Automatic

---

## 🐛 Troubleshooting

### Backend won't start
```bash
# Check Node version
node --version  # Should be 18+

# Check dependencies
rm -rf node_modules package-lock.json
npm install

# Check env variables
cat .env
```

### Frontend build fails
```bash
# Clear cache
rm -rf dist node_modules package-lock.json
npm install
npm run build
```

### Database connection error
```bash
# Verify credentials
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY

# Test connection
curl https://<project>.supabase.co/rest/v1/agencies?select=count
```

---

## 📞 Support

- **Vercel**: https://vercel.com/support
- **Railway**: https://railway.app/support
- **Supabase**: https://supabase.com/support

---

**Deployment complete! 🚀**
