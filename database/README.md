# Database Schema

This directory contains the database schema and initialization scripts for Arcadia For All Mankind.

## Files

- **schema.sql** - Main database schema with all tables, indexes, and RLS policies
- **init.js** - Database initialization script to populate initial data

## Setup Instructions

### 1. Create Tables in Supabase

1. Go to your Supabase project dashboard
2. Open the SQL Editor
3. Copy the entire contents of `schema.sql`
4. Paste it into the SQL Editor
5. Click "Run" to execute

### 2. Initialize Database Data

Run the initialization script:

```bash
node database/init.js
```

Make sure your `.env` file is set up with:
- `SUPABASE_URL`
- `SUPABASE_KEY`

## Database Structure

### Core Tables

#### users
Stores user account information linked to Supabase Auth.

#### agencies
Represents a player's space agency with budget, reputation, and stats.

#### agency_members
Manages team members within an agency.

#### missions
Stores mission data with status, launch dates, and rewards.

#### mission_events
Logs events that occur during mission execution.

#### rockets
Represents launch vehicles with stats like payload capacity.

#### technologies
Tech tree items that agencies can research to unlock.

#### research_projects
Ongoing research efforts by agencies.

#### achievements
Badges and milestones unlocked by agencies.

#### game_events
Global announcements and events affecting the game.

## Row Level Security (RLS)

All tables have RLS enabled with policies to:
- Ensure users only see their own data
- Allow agency members to view agency information
- Protect sensitive operations

## Indexes

Indexes are created on frequently queried columns for performance optimization:
- Email lookups
- Agency ownership
- Mission status queries
- Agency member lookups
