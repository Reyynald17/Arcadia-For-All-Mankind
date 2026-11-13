# AFM — Development Roadmap

## ✅ MVP Complete (Current Branch: mvp-complete)

### Core Features Implemented
- [x] User authentication (register/login)
- [x] Agency dashboard with stats
- [x] Research command system
- [x] Vehicle production
- [x] Mission launching and simulation
- [x] Activity logging
- [x] Global ranking leaderboard
- [x] AGM (Automated Game Master) engine
- [x] Technology tree system
- [x] NPC autopilot framework

### Tech Stack
- [x] Backend: Node.js + Express
- [x] Frontend: React + Vite
- [x] Database: Supabase (PostgreSQL)
- [x] Hosting: Vercel (frontend) + Railway (backend)
- [x] Cost: $0/month

---

## 🚀 Phase 2: Advanced Features

### Timeline & Automation
- [ ] Cron job for AP distribution (every 4 hours = 1 day ACD)
- [ ] NPC autopilot scheduler
- [ ] World event scheduler
- [ ] Automatic stat recalculation

### Gameplay Expansion
- [ ] Facility building system
- [ ] Personnel recruitment
- [ ] Cooperation & diplomacy commands
- [ ] Advanced technology tree (all eras)
- [ ] Crew management
- [ ] Risk/failure analysis

### World Events
- [ ] Random global events
- [ ] Competition system (first-to-X)
- [ ] Political crisis events
- [ ] Economic events
- [ ] Scientific breakthroughs

---

## 📊 Phase 3: Narrative & UI

### Narrative System
- [ ] Static narrative templates
- [ ] Mission report generation
- [ ] News feed system
- [ ] Historical timeline view
- [ ] Agency history tracking

### Enhanced UI
- [ ] Technology tree visualizer
- [ ] Mission simulator preview
- [ ] Stats charts and graphs
- [ ] Dark/light theme toggle
- [ ] Mobile responsiveness

### Admin Features
- [ ] Admin dashboard
- [ ] NPC management interface
- [ ] World state editor
- [ ] Event trigger system
- [ ] Rollback mechanism

---

## 🎮 Phase 4: Full Game

### Additional Commands
- [ ] `/bangun` — Build facilities
- [ ] `/rekrut` — Recruit personnel
- [ ] `/kampanye` — Public campaign
- [ ] `/kerja_sama` — Cooperation

### Social Features
- [ ] Agency profiles
- [ ] Cooperation agreements
- [ ] Diplomatic channels
- [ ] Alliance system
- [ ] Discord integration

### Extended Content
- [ ] All 4 technology eras
- [ ] Colonial missions
- [ ] Space stations
- [ ] Asteroid mining
- [ ] Mars programs

---

## 🐛 Known Limitations (MVP)

- NPC autopilot runs only on manual trigger (needs scheduler)
- No cron-based AP distribution
- No world events
- Limited technology tree (only core tech)
- No cooperation system
- No facility building
- No crew death mechanics
- No narrative AI (static only)

---

## 🎁 Future Nice-to-Haves

- [ ] WebSocket for real-time updates
- [ ] Mobile app (React Native)
- [ ] Analytics dashboard
- [ ] Replay system
- [ ] Tournament mode
- [ ] API documentation (Swagger)
- [ ] Unit tests
- [ ] Load testing

---

## 🛠️ Technical Debt

- [ ] Add input validation
- [ ] Add error handling
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Optimize database queries
- [ ] Add caching layer
- [ ] Add rate limiting
- [ ] Add logging middleware

---

## 📅 Timeline Estimate

| Phase | Features | Estimate | Status |
|-------|----------|----------|--------|
| MVP | Core game | ✅ Done | Complete |
| Phase 2 | Automation + Gameplay | 2-3 weeks | Not started |
| Phase 3 | Narrative + UI | 2-3 weeks | Not started |
| Phase 4 | Full Game | 4-6 weeks | Not started |
| Polish | Testing + Bugs | 1-2 weeks | Not started |

---

## 🤝 Contributing

To work on the next phase:

1. Create a new branch from `mvp-complete`
2. Implement feature
3. Test locally
4. Submit PR with description

---

## 📞 Questions?

Check README.md or DEPLOYMENT.md for details.
