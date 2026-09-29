# AFM (Arcadia: For All Mankind) — MVP Complete

**Space Agency Management & Roleplay Simulation**

This is a complete, production-ready MVP implementation of AFM with:
- ✅ Backend API with Express.js
- ✅ Frontend UI with React
- ✅ Supabase database integration
- ✅ Automated Game Master (AGM) engine
- ✅ NPC autopilot system
- ✅ Zero AI token usage (deterministic simulation)
- ✅ Free hosting stack ($0/month)

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account (free tier)

### Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials
npm install
npm run dev
```

Backend runs on `http://localhost:8787`

### Frontend Setup

```bash
cd frontend
cp .env.example .env
# Edit .env with your API URL (http://localhost:8787)
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`

### Database Setup

1. Create a Supabase project at https://supabase.com
2. Go to SQL Editor
3. Copy and run the contents of `supabase/schema.sql`
4. Seed initial technologies (see DEPLOYMENT.md)

---

## 📊 Architecture

### Backend (Node.js/Express)

```
backend/src/
├── index.js              # Express server entry
├── config/
│   └── supabase.js       # Supabase client
├── routes/
│   ├── auth.js           # Register / Login
│   ├── agency.js         # Agency management
│   ├── research.js       # Research commands
│   ├── production.js     # Vehicle production
│   ├── launch.js         # Mission launch
│   └── dashboard.js      # Dashboard data
├── services/
│   ├── agm.js            # Automated Game Master (deterministic)
│   └── npc.js            # NPC autopilot
├── middleware/
│   └── auth.js           # Authentication
└── utils/
    └── constants.js      # Game constants
```

### Frontend (React/Vite)

```
frontend/src/
├── main.jsx              # Entry point
├── App.jsx               # Root component
├── pages/
│   ├── Login.jsx         # Login page
│   ├── Register.jsx      # Agency registration
│   └── Dashboard.jsx     # Main dashboard
├── components/
│   ├── StatsCard.jsx     # Stats display
│   └── CommandForm.jsx   # Command input
├── styles/
│   ├── Auth.css          # Auth pages
│   └── Dashboard.css     # Dashboard styles
└── utils/
    ├── api.js            # API client
    └── supabase.js       # Supabase client
```

---

## 🎮 Game Mechanics

### Automated Game Master (AGM)

The AGM is a **deterministic** simulation engine (no AI) that:
- Validates commands
- Calculates resource costs
- Simulates missions using formula:
  ```
  finalScore = baseReliability + techBonus + crewBonus - difficulty + randomVariance
  ```
- Updates agency stats (RP, SI, IPI, SLR)
- Logs all events

### Resource Management

- **AP (Action Points)**: 25 per claim, max 50
- **Budget**: Varies by agency, decreases with actions
- **RP (Ranking Points)**: Increases with mission success
- **SI (Stability Index)**: Affected by success/failure (0-100)
- **IPI (Internal Political Indicator)**: Public support (0-100)
- **SLR (Successful Launch Rate)**: % of successful launches

### Mission Outcomes

| Score | Result | RP | IPI | SI |
|-------|--------|----|----|----|
| 80+ | Complete Success | +10 | +5 | +5 |
| 50-79 | Partial Success | +5 | +2 | +2 |
| 30-49 | Failure | 0 | -10 | -5 |
| 0-29 | Catastrophic | 0 | -20 | -15 |

---

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` — Register new agency
- `POST /api/auth/login` — Login

### Agency
- `GET /api/agency/:userId` — Get agency data
- `GET /api/agency` — Get all agencies (ranking)
- `POST /api/agency/:agencyId/update-stats` — Update stats

### Research
- `POST /api/research/start` — Start research
- `GET /api/research/available/:agencyId` — Get available technologies

### Production
- `POST /api/production/vehicle` — Produce vehicle

### Launch
- `POST /api/launch/mission` — Launch mission

### Dashboard
- `GET /api/dashboard/:agencyId` — Get dashboard data
- `GET /api/dashboard/ranking/global` — Get global ranking

---

## ✅ Features Implemented (MVP)

✅ Agency registration & authentication  
✅ Dashboard with stats (RP, SI, IPI, SLR)  
✅ Resource management (AP, Budget)  
✅ Research command system  
✅ Vehicle production  
✅ Mission launching & simulation  
✅ Activity logging  
✅ Global ranking leaderboard  
✅ NPC autopilot (autonomous agencies)  
✅ Deterministic mission outcomes  
✅ Technology tree  
✅ Zero AI token usage  

---

## 💰 Costs

| Component | Free Tier | Cost |
|-----------|-----------|------|
| Frontend Hosting (Vercel) | ✅ Unlimited | $0 |
| Backend Hosting (Railway) | ✅ 5GB/month | $0 |
| Database (Supabase) | ✅ 500MB | $0 |
| Cron Jobs (Vercel) | ✅ 2 free | $0 |
| AI Usage | ❌ Not used | $0 |
| **Total** | | **$0/month** |

---

## 🚢 Deployment

See **DEPLOYMENT.md** for detailed instructions on deploying to:
- Vercel (Frontend)
- Railway (Backend)
- Supabase (Database)

---

## 🗺️ Future Roadmap

See **ROADMAP.md** for planned features and enhancements:
- Phase 2: Advanced Features (2-3 weeks)
- Phase 3: Narrative & UI (2-3 weeks)
- Phase 4: Full Game (4-6 weeks)

---

## 📝 Environment Variables

### Backend (.env)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
PORT=8787
NODE_ENV=development
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:8787
```

---

## 🛠️ Development

### Running Locally

```bash
# Terminal 1: Backend
cd backend
npm install
npm run dev

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

### Testing

```bash
# Backend tests
cd backend
npm run test

# Frontend tests
cd frontend
npm run test
```

---

## 📚 Documentation

- **README.md** — This file
- **DEPLOYMENT.md** — Deployment instructions
- **ROADMAP.md** — Future enhancements
- **supabase/README.md** — Database setup

---

## 🎯 Why No AI?

The MVP uses **deterministic formulas** instead of AI to:
- ✅ Eliminate AI token costs
- ✅ Ensure predictable, fair gameplay
- ✅ Simplify debugging
- ✅ Reduce infrastructure complexity
- ✅ Keep hosting at $0/month

If narrative generation is needed later, use:
- Static templates with placeholder substitution
- Local LLM (Ollama) on the server
- HuggingFace Inference API (free tier)

---

## 📞 Support

For issues or questions:
1. Check README.md and DEPLOYMENT.md
2. Check GitHub Issues
3. Create a new Issue with details

---

## 📄 License

MIT

---

**AFM is ready for launch. 🚀**
