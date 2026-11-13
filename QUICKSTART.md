# AFM — Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Clone Repository

```bash
git clone https://github.com/FrndID/Arcadia-For-All-Mankind.git
cd Arcadia-For-All-Mankind
git checkout mvp-complete
```

### 2. Create Supabase Project

- Go to https://supabase.com
- Create new project (free tier)
- Wait for project to initialize

### 3. Setup Database

```bash
# In Supabase dashboard:
# 1. Go to SQL Editor
# 2. Create new query
# 3. Copy and paste contents of supabase/schema.sql
# 4. Click "Run"
```

### 4. Get Credentials

```bash
# In Supabase dashboard:
# 1. Go to Settings → API
# 2. Copy these values:
#    - Project URL
#    - Service Role Key
#    - Anon Key
```

### 5. Setup Backend

```bash
cd backend
cp .env.example .env

# Edit .env with your Supabase credentials:
# SUPABASE_URL=<your-project-url>
# SUPABASE_SERVICE_ROLE_KEY=<your-key>
# SUPABASE_ANON_KEY=<your-key>

npm install
npm run dev
```

### 6. Setup Frontend

```bash
# In new terminal:
cd frontend
cp .env.example .env

# Edit .env:
# VITE_API_URL=http://localhost:8787

npm install
npm run dev
```

### 7. Access Application

- Open http://localhost:5173
- Register a new agency
- Login and start playing!

---

## 🎮 First Steps

### Register Agency

1. Click "Register" on login page
2. Fill in form:
   - Email: your@email.com
   - Password: secure password
   - Agency Name: My Space Agency
   - Supporting Country: MyCountry
   - Culture: Innovation-focused
   - History: Brief story (optional)
   - Targets: First Orbital Flight, Lunar Probe
3. Click "Register Agency"

### View Dashboard

You'll see:
- **RP** (Ranking Points): 0
- **SI** (Stability): 70
- **IPI** (Political Support): 60
- **SLR** (Launch Success Rate): 0%
- **AP** (Action Points): 25/50
- **Budget**: 50

### Start First Research

1. Go to "Commands" tab
2. Select "Start Research"
3. Choose "Liquid Propulsion"
4. Click "Execute Command"
5. Check logs for success message

### Produce First Vehicle

1. Go to "Commands" tab
2. Select "Produce Vehicle"
3. Enter name: "First Rocket"
4. Choose type: "Sounding Rocket"
5. Click "Execute Command"

### Launch First Mission

1. Go to "Commands" tab
2. Select "Launch Mission"
3. Enter name: "Test Flight 1"
4. Choose type: "Test Flight"
5. Click "Execute Command"
6. Check mission results in "Missions" tab

---

## 📊 Understanding Stats

### RP (Ranking Points)
- Increases with mission success
- Determines global ranking
- Goal: Be #1 on leaderboard

### SI (Stability Index) 0-100
- Decreases with failures
- Affected by game events
- Below 30: Crisis
- Below 0: Agency collapse

### IPI (Political Support) 0-100
- Public support for space program
- Affects budget allocation
- Low IPI: Budget cuts

### SLR (Launch Success Rate) %
- % of successful launches
- Built on first successful mission
- Affects reputation

### AP (Action Points)
- Resource to perform actions
- 25 per distribution
- Max 50
- Used for: research, production, missions

### Budget
- Money for operations
- Decreases with actions
- Varies by agency
- Needed for all activities

---

## 🔍 Check Your Progress

### Dashboard
- View current stats
- See AP and Budget
- Check recent activity

### Missions Tab
- See all launched missions
- Check results and RP gains

### Vehicles Tab
- View all vehicles
- Check reliability and launch history

### Ranking Tab
- See global leaderboard
- Compare with other agencies
- Find your rank

---

## ❓ Troubleshooting

### "Insufficient AP" error
- Check your AP balance
- Wait for AP distribution
- Use commands carefully

### "Insufficient Budget" error
- Check your budget
- Budget decreases with actions
- Future updates will add income sources

### "Technology not found" error
- Check technology name spelling
- Ensure tech exists in database
- See available tech in API

### Frontend won't load
- Check backend is running: http://localhost:8787/api/health
- Check .env has correct API URL
- Clear browser cache

### Backend won't start
- Check .env variables are set
- Check Node version: `node --version`
- Run: `npm install`

---

## 📚 Next Steps

1. **Read Full Documentation**
   - README.md: Overview
   - DEPLOYMENT.md: Production setup
   - ROADMAP.md: Future features

2. **Explore API**
   - Check backend/src/routes/ for endpoints
   - Use Postman to test endpoints
   - See API documentation in README.md

3. **Customize Game**
   - Edit backend/src/utils/constants.js for game rules
   - Add more technologies
   - Adjust mission costs

4. **Deploy to Production**
   - Follow DEPLOYMENT.md
   - Deploy frontend to Vercel
   - Deploy backend to Railway

---

## 🆘 Need Help?

- Check README.md FAQ
- See DEPLOYMENT.md troubleshooting
- Check GitHub Issues
- Create new Issue

---

**Good luck, Agency Director! 🚀**
