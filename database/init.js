/**
 * Database Initialization Script
 * Run this to set up initial data in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function initializeDatabase() {
  try {
    console.log('Starting database initialization...');

    // Test connection
    const { data, error } = await supabase.from('users').select('count').limit(1);
    if (error) throw error;

    console.log('✓ Successfully connected to Supabase');

    // Insert default game events
    const { error: gameEventsError } = await supabase
      .from('game_events')
      .insert([
        {
          title: 'Welcome to Arcadia For All Mankind',
          description: 'Start your space agency and compete with others in this space race simulation.',
          event_type: 'announcement',
          severity: 'info',
          affects_all: true,
        },
      ]);

    if (gameEventsError) throw gameEventsError;
    console.log('✓ Default game events created');

    console.log('\n✅ Database initialization completed successfully!');
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    process.exit(1);
  }
}

initializeDatabase();
