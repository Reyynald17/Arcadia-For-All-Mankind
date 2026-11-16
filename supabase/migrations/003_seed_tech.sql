-- 003_seed_tech.sql
-- Phase 0: starter catalog for Eras I-IV. Upserts by node_id and is safe to re-run.
-- Legacy display names are preserved for the six pre-existing nodes so that
-- research logs and the current UI keep resolving during the transition.

with catalog (
  node_id,
  name,
  title,
  description,
  discipline_id,
  era_number,
  alignment_affinity,
  science_points,
  funding_usd,
  base_days,
  unlock_trl,
  export_controlled,
  dependency_impact,
  prereqs
) as (
  values
    ('PROP_101_ALCOHOL_LOX', 'Alcohol/LOX Propulsion', 'Alcohol/LOX Propulsion', 'Pressure-fed alcohol and liquid oxygen engine for early sounding and orbital stages.', 'PROP', 1, 'ANY', 80, 1200000, 90, 4, false, 0, ARRAY[]::text[]),
    ('IND_101_SEGMENTED_SOLIDS', 'Segmented Solid Boosters', 'Segmented Solid Boosters', 'Castable segmented solid motors that can be clustered without cryogenic infrastructure.', 'PROP', 1, 'INDEPENDENT', 95, 1400000, 110, 4, false, 0, ARRAY[]::text[]),
    ('STRC_101_BASIC_AIRFRAME', 'Basic Airframe and Fins', 'Basic Airframe and Fins', 'Light alloy tank structures, stabilising fins, and separation interfaces for expendable launchers.', 'STRC', 1, 'ANY', 70, 1000000, 100, 4, false, 0, ARRAY[]::text[]),
    ('AVNC_101_INERTIAL_GUIDANCE', 'Inertial Guidance', 'Inertial Guidance', 'Gyroscope and accelerometer guidance with ground-based radio correction.', 'AVNC', 1, 'ANY', 80, 1100000, 100, 4, false, 0, ARRAY[]::text[]),
    ('SCNC_101_VHF_TELEMETRY', 'TELEMETRI DUA ARAH & RADAR', 'VHF Telemetry and Radar', 'Two-way VHF telemetry, command receivers, and acquisition radars for range safety.', 'SCNC', 1, 'ANY', 60, 900000, 80, 4, false, 0, ARRAY[]::text[]),
    ('LIFE_101_PRESSURIZED_CAPSULE', 'Pressurized Capsule', 'Pressurized Capsule', 'Sealed single-seat capsule with basic life support and ablative recovery.', 'LIFE', 1, 'ANY', 90, 1300000, 120, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME']::text[]),
    ('POWR_101_BATTERY_POWER', 'Silver-Zinc Battery Power', 'Silver-Zinc Battery Power', 'High-density silver-zinc cells for short-duration spacecraft electrical loads.', 'POWR', 1, 'ANY', 55, 800000, 70, 4, false, 0, ARRAY[]::text[]),
    ('PROP_201_LOX_RP1', 'PROPULSI CAIR TAHAP I (LOX/RP-1)', 'LOX/RP-1 Propulsion', 'Pump-fed kerosene and liquid oxygen propulsion for medium-lift first stages.', 'PROP', 2, 'ANY', 120, 2200000, 140, 4, false, 0, ARRAY['PROP_101_ALCOHOL_LOX']::text[]),
    ('WST_201_CRYO_HYDROLOX', 'CRYOGENIC HYDROGEN STAGE (LH2/LOX)', 'Cryogenic Hydrolox Upper Stage', 'High-energy liquid hydrogen upper stage with insulated tanks and restart capability.', 'PROP', 2, 'WESTERN', 150, 3200000, 160, 4, true, 12, ARRAY['PROP_201_LOX_RP1']::text[]),
    ('EST_201_HYPERGOLIC', 'Hypergolic Propulsion', 'Hypergolic Propulsion', 'Storable nitrogen-tetroxide and hydrazine engines for reliable upper-stage ignition.', 'PROP', 2, 'EASTERN', 150, 3200000, 160, 4, true, 12, ARRAY['PROP_201_LOX_RP1']::text[]),
    ('IND_201_MULTICORE_CLUSTERING', 'Multi-Core Strap-On Clustering', 'Multi-Core Strap-On Clustering', 'Parallel core and booster clustering with simplified propellant cross-feed.', 'STRC', 2, 'INDEPENDENT', 140, 2800000, 170, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME', 'PROP_101_ALCOHOL_LOX']::text[]),
    ('STRC_201_STAGE_SEPARATION', 'STAGE SEPARATION & ULLAGE ROCKETS', 'Stage Separation and Ullage', 'Cold-gas pushers, separation clamps, and ullage motors for reliable stage ignition.', 'STRC', 2, 'ANY', 110, 2000000, 140, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME']::text[]),
    ('STRC_201_ABLATIVE_HEAT_SHIELD', 'HEAT SHIELD ABLATIF KECEPATAN BULAN', 'Ablative Heat Shield', 'Lunar-return ablator, honeycomb carrier, and parachute recovery interface.', 'STRC', 2, 'ANY', 130, 2400000, 160, 4, false, 0, ARRAY['STRC_101_BASIC_AIRFRAME']::text[]),
    ('LIFE_201_TWO_CREW_CAPSULE', 'KAPSUL DUA AWAK VALORIA-MKII', 'Two-Crew Pressurized Capsule', 'Two-seat capsule with redundant life support, docking probe, and lunar-return rating.', 'LIFE', 2, 'ANY', 150, 2600000, 170, 4, false, 0, ARRAY['LIFE_101_PRESSURIZED_CAPSULE', 'STRC_201_ABLATIVE_HEAT_SHIELD']::text[]),
    ('AVNC_201_AUTOMATED_RENDEZVOUS', 'Automated Rendezvous and Docking', 'Automated Rendezvous and Docking', 'Radar-guided terminal rendezvous, attitude control, and hard-dock sequencing.', 'AVNC', 2, 'EASTERN', 160, 3000000, 180, 4, true, 15, ARRAY['AVNC_101_INERTIAL_GUIDANCE']::text[]),
    ('EST_301_STAGED_COMBUSTION', 'Closed-Cycle Staged Combustion', 'Closed-Cycle Staged Combustion', 'High-pressure staged-combustion engine cycle with regenerative cooling and deep throttling.', 'PROP', 3, 'EASTERN', 210, 4500000, 220, 4, true, 18, ARRAY['EST_201_HYPERGOLIC']::text[]),
    ('WST_301_DIGITAL_FLY_BY_WIRE', 'Digital Fly-by-Wire', 'Digital Fly-by-Wire', 'Redundant digital flight computers, rate gyros, and electrically signalled control surfaces.', 'AVNC', 3, 'WESTERN', 210, 4200000, 220, 4, true, 10, ARRAY['AVNC_101_INERTIAL_GUIDANCE']::text[]),
    ('WST_301_REUSABLE_TPS', 'Reusable TPS Tiles', 'Reusable Thermal Protection Tiles', 'Ceramic tile thermal protection, reusable seals, and post-flight inspection procedures.', 'STRC', 3, 'WESTERN', 220, 4800000, 240, 4, true, 10, ARRAY['STRC_201_ABLATIVE_HEAT_SHIELD']::text[]),
    ('IND_301_HYBRID_UPPER_STAGE', 'Hybrid Solid-Liquid Upper Stage', 'Hybrid Solid-Liquid Upper Stage', 'Hybrid upper stage with solid fuel grain, liquid oxidiser, and restartable ignition.', 'PROP', 3, 'INDEPENDENT', 200, 4000000, 230, 4, false, 0, ARRAY['IND_201_MULTICORE_CLUSTERING', 'PROP_201_LOX_RP1']::text[]),
    ('IND_302_CROSS_BLOC_ADAPTERS', 'Cross-Bloc Interface Adapters', 'Cross-Bloc Interface Adapters', 'Standardised payload adapters, ring interfaces, and local metallurgy for mixed supply chains.', 'STRC', 3, 'INDEPENDENT', 180, 3600000, 210, 4, false, 0, ARRAY['IND_201_MULTICORE_CLUSTERING']::text[]),
    ('LIFE_301_SEMI_CLOSED_ECLSS', 'Semi-Closed ECLSS', 'Semi-Closed ECLSS', 'Regenerative carbon dioxide removal, water recovery, and multi-crew cabin atmosphere control.', 'LIFE', 3, 'ANY', 200, 4200000, 230, 4, false, 0, ARRAY['LIFE_201_TWO_CREW_CAPSULE']::text[]),
    ('POWR_301_RTG', 'RTG Power Source', 'Radioisotope Thermoelectric Generator', 'Long-lived radioisotope power for deep-space probes and lunar surface payloads.', 'POWR', 3, 'ANY', 190, 3800000, 200, 4, false, 0, ARRAY['POWR_101_BATTERY_POWER']::text[]),
    ('SCNC_301_XBAND_DSN', 'X-Band Deep Space Comms', 'X-Band Deep Space Communications', 'High-gain X-band ground segment, ranging tones, and deep-space telemetry coding.', 'SCNC', 3, 'ANY', 180, 3500000, 200, 4, false, 0, ARRAY['SCNC_101_VHF_TELEMETRY']::text[]),
    ('PROP_401_PROPULSIVE_LANDING', 'Deep-Throttling Propulsive Landing', 'Deep-Throttling Propulsive Landing', 'Throttleable landing engine, gimbal authority, and terminal guidance for powered recovery.', 'PROP', 4, 'ANY', 300, 6500000, 300, 4, false, 0, ARRAY['PROP_201_LOX_RP1', 'AVNC_101_INERTIAL_GUIDANCE']::text[]),
    ('PROP_401_ION_THRUSTER', 'Ion Thruster', 'Gridded Ion Thruster', 'Electrostatic ion propulsion with high specific impulse for long-duration orbital transfers.', 'PROP', 4, 'ANY', 280, 6000000, 280, 4, false, 0, ARRAY['POWR_301_RTG']::text[]),
    ('LIFE_401_CLOSED_LOOP_ECLSS', 'Closed-Loop ECLSS', 'Closed-Loop ECLSS', 'Full air and water recycling for long-duration stations and interplanetary transit.', 'LIFE', 4, 'ANY', 280, 6200000, 300, 4, false, 0, ARRAY['LIFE_301_SEMI_CLOSED_ECLSS']::text[]),
    ('STRC_401_INFLATABLE_HABITAT', 'Inflatable Habitat', 'Inflatable Habitat', 'Multi-layer inflatable pressure shell with rigid core and deployable shielding.', 'STRC', 4, 'ANY', 290, 6300000, 300, 4, false, 0, ARRAY['STRC_201_ABLATIVE_HEAT_SHIELD']::text[]),
    ('POWR_401_SABATIER_ISRU', 'Sabatier ISRU', 'Sabatier In-Situ Resource Utilisation', 'Carbon dioxide and hydrogen processing for methane and water production on other worlds.', 'POWR', 4, 'ANY', 260, 5500000, 260, 4, false, 0, ARRAY['POWR_301_RTG']::text[]),
    ('IND_401_SEA_LAUNCH_PLATFORM', 'Equatorial Sea-Launch Platform', 'Equatorial Sea-Launch Platform', 'Mobile equatorial launch platform with azimuth flexibility and maritime range support.', 'STRC', 4, 'INDEPENDENT', 250, 5800000, 280, 4, false, 0, ARRAY['IND_302_CROSS_BLOC_ADAPTERS']::text[])
),
prepared as (
  select
    catalog.*,
    greatest(1, round(science_points / 10.0))::int as legacy_ap,
    greatest(1, round(funding_usd / 100000.0))::int as legacy_budget,
    greatest(1, ceil(base_days / 52.142857))::int as legacy_days,
    case node_id
      when 'PROP_101_ALCOHOL_LOX' then array['eng_alcohol_lox_basic']::text[]
      when 'PROP_201_LOX_RP1' then array['eng_lox_rp1_mid']::text[]
      when 'WST_201_CRYO_HYDROLOX' then array['eng_hydrolox_upper']::text[]
      when 'EST_201_HYPERGOLIC' then array['eng_hypergolic_upper']::text[]
      when 'EST_301_STAGED_COMBUSTION' then array['eng_rd253_heavy', 'eng_preburner_ox']::text[]
      when 'IND_301_HYBRID_UPPER_STAGE' then array['eng_hybrid_upper']::text[]
      when 'PROP_401_PROPULSIVE_LANDING' then array['eng_throttleable_lander']::text[]
      when 'PROP_401_ION_THRUSTER' then array['eng_ion_grid']::text[]
      else array[]::text[]
    end as unlocks_parts
  from catalog
)
insert into technologies (
  node_id,
  name,
  era,
  research_cost_ap,
  research_cost_budget,
  duration_days,
  prerequisite,
  description,
  discipline_id,
  alignment_affinity,
  era_number,
  research_cost_science,
  research_cost_funding,
  base_days,
  prerequisite_node_ids,
  unlock_trl,
  max_trl,
  base_failure_rate,
  min_failure_rate,
  static_test_cost,
  is_export_controlled,
  dependency_impact,
  unlocks_parts,
  spec
)
select
  node_id,
  name,
  'TIER 0' || era_number,
  legacy_ap,
  legacy_budget,
  legacy_days,
  array[]::text[],
  description,
  discipline_id,
  alignment_affinity,
  era_number,
  science_points,
  funding_usd,
  base_days,
  prereqs,
  unlock_trl,
  9,
  0.15,
  0.008,
  150000 * era_number,
  export_controlled,
  dependency_impact,
  unlocks_parts,
  jsonb_build_object(
    'id', node_id,
    'era', era_number,
    'discipline_id', discipline_id,
    'alignment_affinity', alignment_affinity,
    'title', title,
    'description', description,
    'prerequisites', jsonb_build_object(
      'tech_ids', to_jsonb(prereqs),
      'science_requirements', '[]'::jsonb
    ),
    'research_cost', jsonb_build_object(
      'science_points', science_points,
      'funding_usd', funding_usd,
      'base_days', base_days
    ),
    'cost_modifiers', case
      when alignment_affinity = 'ANY' then jsonb_build_object(
        'WESTERN', jsonb_build_object('science_mult', 1.0, 'days_mult', 1.0, 'requires_license', false),
        'EASTERN', jsonb_build_object('science_mult', 1.0, 'days_mult', 1.0, 'requires_license', false),
        'INDEPENDENT', jsonb_build_object('science_mult', 1.0, 'days_mult', 1.0, 'requires_license', false)
      )
      else jsonb_build_object(
        'WESTERN', jsonb_build_object(
          'science_mult', case when alignment_affinity = 'WESTERN' then 0.65 else 1.35 end,
          'days_mult', case when alignment_affinity = 'WESTERN' then 0.60 else 1.25 end,
          'requires_license', alignment_affinity = 'WESTERN'
        ),
        'EASTERN', jsonb_build_object(
          'science_mult', case when alignment_affinity = 'EASTERN' then 0.65 else 1.35 end,
          'days_mult', case when alignment_affinity = 'EASTERN' then 0.60 else 1.25 end,
          'requires_license', alignment_affinity = 'EASTERN'
        ),
        'INDEPENDENT', jsonb_build_object(
          'science_mult', case when alignment_affinity = 'INDEPENDENT' then 0.65 else 1.75 end,
          'days_mult', case when alignment_affinity = 'INDEPENDENT' then 0.60 else 1.60 end,
          'requires_license', false
        )
      )
    end,
    'embargo_risk', jsonb_build_object(
      'is_export_controlled', export_controlled,
      'dependency_impact', dependency_impact,
      'min_standing_required', case when export_controlled then 70 else 0 end,
      'fallback_local_variant', null
    ),
    'trl_profile', jsonb_build_object(
      'unlock_trl', unlock_trl,
      'max_trl', 9,
      'base_failure_rate', 0.15,
      'min_failure_rate', 0.008,
      'static_test_cost', 150000 * era_number
    ),
    'unlocks_parts', to_jsonb(unlocks_parts)
  )
from prepared
on conflict (node_id) do update set
  name = excluded.name,
  era = excluded.era,
  research_cost_ap = excluded.research_cost_ap,
  research_cost_budget = excluded.research_cost_budget,
  duration_days = excluded.duration_days,
  prerequisite = excluded.prerequisite,
  description = excluded.description,
  discipline_id = excluded.discipline_id,
  alignment_affinity = excluded.alignment_affinity,
  era_number = excluded.era_number,
  research_cost_science = excluded.research_cost_science,
  research_cost_funding = excluded.research_cost_funding,
  base_days = excluded.base_days,
  prerequisite_node_ids = excluded.prerequisite_node_ids,
  unlock_trl = excluded.unlock_trl,
  max_trl = excluded.max_trl,
  base_failure_rate = excluded.base_failure_rate,
  min_failure_rate = excluded.min_failure_rate,
  static_test_cost = excluded.static_test_cost,
  is_export_controlled = excluded.is_export_controlled,
  dependency_impact = excluded.dependency_impact,
  unlocks_parts = excluded.unlocks_parts,
  spec = excluded.spec;

-- Legacy backend reads names from the prerequisite array.
update technologies t
set prerequisite = coalesce(
  (
    select array_agg(p.name order by p.era_number, p.name)
    from technologies p
    where p.node_id = any(t.prerequisite_node_ids)
  ),
  '{}'::text[]
)
where cardinality(t.prerequisite_node_ids) > 0;

do $$
begin
  if exists (
    select 1
    from technologies t
    cross join lateral unnest(t.prerequisite_node_ids) as req(node_id)
    left join technologies p on p.node_id = req.node_id
    where p.id is null
  ) then
    raise exception 'Tech seed contains unresolved prerequisite node ids';
  end if;
end
$$;
