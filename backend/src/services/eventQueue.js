const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 10 * 60 * 1000;
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 15 * 60 * 1000;

function retryDelayMs(attempts) {
  const exponent = Math.max(0, Number(attempts) - 1);
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** exponent);
}

function createEventQueue({
  supabase,
  handlers,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  logger = console,
} = {}) {
  if (!supabase) throw new Error('supabase client is required');
  if (!handlers || typeof handlers !== 'object') throw new Error('handlers are required');

  const safeInterval = Math.max(1000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
  const safeBatchSize = Math.max(1, Math.min(100, Number(batchSize) || DEFAULT_BATCH_SIZE));
  const safeMaxAttempts = Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);

  let timer = null;
  let running = false;
  let stopped = false;

  async function recoverStaleEvents() {
    const cutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
    const { error } = await supabase
      .from('scheduled_events')
      .update({
        status: 'PENDING',
        locked_at: null,
        last_error: 'Recovered stale PROCESSING lock',
      })
      .eq('status', 'PROCESSING')
      .lt('locked_at', cutoff);

    if (error) throw new Error(`scheduled_events recovery: ${error.message}`);
  }

  async function claimEvent(event) {
    const { data, error } = await supabase
      .from('scheduled_events')
      .update({
        status: 'PROCESSING',
        locked_at: new Date().toISOString(),
        attempts: Number(event.attempts || 0) + 1,
      })
      .eq('id', event.id)
      .eq('status', 'PENDING')
      .select('*')
      .maybeSingle();

    if (error) throw new Error(`claim ${event.id}: ${error.message}`);
    return data;
  }

  async function markProcessed(event, result) {
    const { error } = await supabase
      .from('scheduled_events')
      .update({
        status: 'PROCESSED',
        processed_at: new Date().toISOString(),
        result_log: result ?? {},
        last_error: null,
      })
      .eq('id', event.id)
      .eq('status', 'PROCESSING');

    if (error) throw new Error(`complete ${event.id}: ${error.message}`);
  }

  async function markFailed(event, failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    const attempts = Number(event.attempts || 1);
    const terminal = attempts >= safeMaxAttempts;
    const patch = terminal
      ? {
        status: 'FAILED',
        processed_at: new Date().toISOString(),
        last_error: message,
      }
      : {
        status: 'PENDING',
        locked_at: null,
        execute_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
        last_error: message,
      };

    const { error } = await supabase
      .from('scheduled_events')
      .update(patch)
      .eq('id', event.id)
      .eq('status', 'PROCESSING');

    if (error) throw new Error(`fail ${event.id}: ${error.message}`);
  }

  async function processDueEvents() {
    if (running || stopped) return { processed: 0, failed: 0, skipped: 0 };

    running = true;
    try {
      const { data: dueEvents, error } = await supabase
        .from('scheduled_events')
        .select('*')
        .eq('status', 'PENDING')
        .lte('execute_at', new Date().toISOString())
        .order('execute_at', { ascending: true })
        .limit(safeBatchSize);

      if (error) throw new Error(`poll scheduled_events: ${error.message}`);

      let processed = 0;
      let failed = 0;
      let skipped = 0;

      for (const candidate of dueEvents || []) {
        if (stopped) break;

        let event;
        try {
          event = await claimEvent(candidate);
        } catch (claimError) {
          logger.error(`[event-queue] ${claimError.message}`);
          skipped += 1;
          continue;
        }

        if (!event) {
          skipped += 1;
          continue;
        }

        try {
          const handler = handlers[event.event_type];
          if (typeof handler !== 'function') {
            throw new Error(`No handler for event type ${event.event_type}`);
          }

          const result = await handler(event);
          await markProcessed(event, result);
          processed += 1;
        } catch (handlerError) {
          try {
            await markFailed(event, handlerError);
          } catch (updateError) {
            logger.error(`[event-queue] ${updateError.message}`);
          }
          failed += 1;
          logger.error(`[event-queue] ${event.event_type}/${event.id}: ${handlerError.message}`);
        }
      }

      return { processed, failed, skipped };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    stopped = false;

    void (async () => {
      try {
        await recoverStaleEvents();
      } catch (error) {
        logger.error(`[event-queue] ${error.message}`);
      }

      try {
        await processDueEvents();
      } catch (error) {
        logger.error(`[event-queue] ${error.message}`);
      }
    })();

    timer = setInterval(() => {
      processDueEvents().catch((error) => logger.error(`[event-queue] ${error.message}`));
    }, safeInterval);

    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, processDueEvents, recoverStaleEvents };
}

module.exports = { createEventQueue, retryDelayMs };
