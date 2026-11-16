-- 004_seed_stations.sql
-- Phase 0: ground and ship tracking network. Upserts by station code.

with stations (
  code,
  name,
  location,
  lat,
  lon,
  min_elevation_deg,
  asset_type,
  faction,
  altitude_km
) as (
  values
    ('GDS_KOUROU', 'Guiana Space Centre', 'Kourou, French Guiana', 5.159, -52.649, 5, 'GROUND', 'WESTERN', 0),
    ('GDS_CAPE', 'Cape Canaveral', 'Florida, United States', 28.572, -80.649, 5, 'GROUND', 'WESTERN', 0),
    ('GDS_MADRID', 'Madrid Deep Space', 'Robledo de Chavela, Spain', 40.431, -4.248, 10, 'GROUND', 'WESTERN', 0),
    ('GDS_CARNARVON', 'Carnarvon Tracking', 'Western Australia', -24.882, 113.661, 5, 'GROUND', 'WESTERN', 0),
    ('GDS_PLESETSK', 'Plesetsk', 'Arkhangelsk Oblast, USSR', 62.927, 40.577, 5, 'GROUND', 'EASTERN', 0),
    ('GDS_BAIKONUR', 'Baikonur', 'Kazakhstan', 45.965, 63.305, 5, 'GROUND', 'EASTERN', 0),
    ('GDS_USUDA', 'Usuda Deep Space', 'Nagano, Japan', 36.132, 138.362, 10, 'GROUND', 'EASTERN', 0),
    ('GDS_SRIHARIKOTA', 'Sriharikota', 'Andhra Pradesh, India', 13.733, 80.235, 5, 'GROUND', 'INDEPENDENT', 0),
    ('GDS_TANEGASHIMA', 'Tanegashima', 'Kagoshima, Japan', 30.400, 130.969, 5, 'GROUND', 'INDEPENDENT', 0),
    ('GDS_SAN_MARCO', 'San Marco Platform', 'Indian Ocean off Kenya', -2.938, 40.212, 5, 'GROUND', 'INDEPENDENT', 0),
    ('GDS_TRACK_ATLANTIC', 'Atlantic Tracking Ship', 'Atlantic Ocean', 0.000, -30.000, 5, 'SHIP', 'NEUTRAL', 0),
    ('GDS_TRACK_PACIFIC', 'Pacific Tracking Ship', 'Pacific Ocean', 0.000, -150.000, 5, 'SHIP', 'NEUTRAL', 0)
)
insert into ground_stations (
  code,
  name,
  location,
  lat,
  lon,
  min_elevation_deg,
  asset_type,
  faction,
  altitude_km
)
select
  code,
  name,
  location,
  lat,
  lon,
  min_elevation_deg,
  asset_type,
  faction,
  altitude_km
from stations
on conflict (code) do update set
  name = excluded.name,
  location = excluded.location,
  lat = excluded.lat,
  lon = excluded.lon,
  min_elevation_deg = excluded.min_elevation_deg,
  asset_type = excluded.asset_type,
  faction = excluded.faction,
  altitude_km = excluded.altitude_km,
  active = true;
