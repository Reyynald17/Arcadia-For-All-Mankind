require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { createEventQueue } = require('./services/eventQueue');
const { handleTechComplete } = require('./services/researchEngine');
const { handleStaticFire } = require('./services/trlEngine');
const { handleProductionComplete } = require('./services/productionEngine');
const {
  handleRolloutComplete,
  handleLaunchIgnition,
  handleOrbitOperationsComplete,
} = require('./services/launchEngine');
const {
  handleProposalExpired,
  handleAgreementExpired,
  handleNpcTick,
  ensureNpcTickScheduled,
} = require('./services/diplomacyEngine');
const {
  handleBudgetReview,
  ensureBudgetSchedules,
} = require('./services/budgetEngine');
const { handleCrewTrainingComplete } = require('./services/crewEngine');
const { handleInvestigationComplete } = require('./services/investigationEngine');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 8787;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Dedicated auth client: sign-in sets a user session on the client, which would
// switch the shared service-role client to the user's JWT and trip RLS on data writes.
const authClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

const eventQueue = createEventQueue({
  supabase,
  handlers: {
    TECH_COMPLETE: (event) => handleTechComplete(supabase, event),
    STATIC_FIRE: (event) => handleStaticFire(supabase, event),
    PRODUCTION_COMPLETE: (event) => handleProductionComplete(supabase, event),
    ROLLOUT_COMPLETE: (event) => handleRolloutComplete(supabase, event),
    LAUNCH_IGNITION: (event) => handleLaunchIgnition(supabase, event),
    ORBIT_OPERATIONS_COMPLETE: (event) => handleOrbitOperationsComplete(supabase, event),
    DIPLOMACY_PROPOSAL_EXPIRED: (event) => handleProposalExpired(supabase, event),
    DIPLOMACY_AGREEMENT_EXPIRED: (event) => handleAgreementExpired(supabase, event),
    DIPLOMACY_NPC_TICK: (event) => handleNpcTick(supabase, event),
    BUDGET_REVIEW: (event) => handleBudgetReview(supabase, event),
    CREW_TRAINING_COMPLETE: (event) => handleCrewTrainingComplete(supabase, event),
    INVESTIGATION_COMPLETE: (event) => handleInvestigationComplete(supabase, event),
  },
  intervalMs: Number(process.env.EVENT_QUEUE_INTERVAL_MS) || 5000,
  batchSize: Number(process.env.EVENT_QUEUE_BATCH_SIZE) || 10,
  maxAttempts: Number(process.env.EVENT_QUEUE_MAX_ATTEMPTS) || 3,
});

// Routes
app.use('/api/auth', require('./routes/auth')(supabase, authClient));
app.use('/api/agency', require('./routes/agency')(supabase));
app.use('/api/research', require('./routes/research')(supabase));
app.use('/api/production', require('./routes/production')(supabase));
app.use('/api/launch', require('./routes/launch')(supabase));
app.use('/api/orbit', require('./routes/orbit')(supabase));
app.use('/api/dashboard', require('./routes/dashboard')(supabase));
app.use('/api/diplomacy', require('./routes/diplomacy')(supabase));
app.use('/api/calendar', require('./routes/calendar')(supabase));
app.use('/api/economy', require('./routes/economy')(supabase));
app.use('/api/personnel', require('./routes/personnel')(supabase));
app.use('/api/gm', require('./routes/gm')(supabase));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`✅ AFM Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  if (process.env.EVENT_QUEUE_ENABLED !== 'false') {
    eventQueue.start();
    console.log('[event-queue] worker started');
    ensureNpcTickScheduled(supabase)
      .then((event) => console.log(`[diplomacy] npc tick scheduled: ${event.id}`))
      .catch((error) => console.error(`[diplomacy] npc tick bootstrap failed: ${error.message}`));
    ensureBudgetSchedules(supabase)
      .then((result) => console.log(`[budget] schedules ready: ${result.scheduled} new`))
      .catch((error) => console.error(`[budget] bootstrap failed: ${error.message}`));
  }
});

function shutdown(signal) {
  console.log(`[backend] ${signal} received, shutting down`);
  eventQueue.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;