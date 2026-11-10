-- Yoon · schéma initial. Montants en FCFA entiers. Horodatages en timestamptz (affichage Africa/Dakar).
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,               -- E.164 normalisé (+221…)
  name text not null,
  role text not null check (role in ('merchant','courier','admin')),
  password_hash text not null,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index on sessions(user_id);

create table zones (
  id serial primary key,
  name text not null unique,
  department text not null check (department in ('Dakar','Pikine','Guédiawaye','Rufisque','Keur Massar')),
  active boolean not null default false,    -- sous-ensemble activable pour le pilote
  center_lat double precision,
  center_lng double precision
);

-- Tarifs versionnés : une version active à la fois ; chaque commande fige sa version.
create table pricing_versions (
  id serial primary key,
  created_at timestamptz not null default now(),
  created_by uuid references users(id),
  note text not null default '',
  courier_share_bps int not null check (courier_share_bps between 0 and 10000),
  cancel_fee int not null check (cancel_fee >= 0),                       -- après attribution
  cancel_courier_share_bps int not null check (cancel_courier_share_bps between 0 and 10000),
  not_found_fee int not null check (not_found_fee >= 0),                 -- frais de déplacement client introuvable
  not_found_wait_minutes int not null check (not_found_wait_minutes between 0 and 120),
  is_demo boolean not null default false,
  active boolean not null default false
);
create unique index pricing_one_active on pricing_versions(active) where active;

create table pricing_pairs (
  version_id int not null references pricing_versions(id),
  from_zone_id int not null references zones(id),
  to_zone_id int not null references zones(id),
  price int not null check (price > 0),
  primary key (version_id, from_zone_id, to_zone_id)
);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references users(id),
  name text not null,
  phone text not null,
  zone_id int not null references zones(id),
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  wave_number text,                -- numéro où le client paie la commande
  orange_money_number text,
  created_at timestamptz not null default now()
);

create table courier_profiles (
  user_id uuid primary key references users(id),
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  vehicle text not null default 'moto',
  home_zone_id int references zones(id),
  available boolean not null default false,
  last_lat double precision,
  last_lng double precision,
  last_accuracy double precision,
  last_position_at timestamptz,
  approved_by uuid references users(id),
  approved_at timestamptz,
  payout_method text check (payout_method in ('wave','orange_money')),
  payout_number text
);

create sequence order_ref_seq start 1001;

create table orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('YN-' || nextval('order_ref_seq')),
  shop_id uuid not null references shops(id),
  customer_name text not null,
  customer_phone text not null,
  order_amount int not null check (order_amount >= 0),
  pickup_zone_id int not null references zones(id),
  pickup_address text not null,
  dest_zone_id int not null references zones(id),
  dest_hint text not null default '',
  delivery_payer text not null check (delivery_payer in ('merchant','customer')),
  pricing_version_id int not null references pricing_versions(id),
  delivery_price int not null check (delivery_price > 0),
  courier_earning int not null check (courier_earning >= 0),
  commission int not null check (commission >= 0),
  status text not null default 'awaiting_location',
  incident_resume_status text,
  courier_id uuid references users(id),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  constraint price_split check (courier_earning + commission = delivery_price),
  constraint order_status check (status in ('awaiting_location','ready','offered','assigned','at_pickup','picked_up','in_delivery','incident','delivered','cancelled'))
);
create unique index orders_idem on orders(shop_id, idempotency_key) where idempotency_key is not null;
-- Un livreur n'a qu'une course active (pas de livraison groupée) : empêche la double attribution.
create unique index orders_one_active_per_courier on orders(courier_id)
  where status in ('assigned','at_pickup','picked_up','in_delivery','incident');
create index on orders(shop_id, created_at desc);
create index on orders(status);

create table client_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create table customer_locations (
  id serial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  source text not null check (source in ('gps','map','operator','landmark_only')),
  lat double precision,
  lng double precision,
  accuracy double precision,
  landmark text not null default '',
  photo_media_id uuid,
  voice_media_id uuid,
  created_by text not null,
  created_at timestamptz not null default now()
);
create index on customer_locations(order_id, created_at desc);

create table offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  courier_id uuid not null references users(id),
  status text not null default 'pending' check (status in ('pending','accepted','refused','expired','withdrawn')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz
);
create unique index offers_one_pending_per_order on offers(order_id) where status = 'pending';
create unique index offers_one_pending_per_courier on offers(courier_id) where status = 'pending';
create unique index offers_one_accepted_per_order on offers(order_id) where status = 'accepted';

create table delivery_events (
  id bigserial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  type text not null,
  actor text not null,
  actor_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on delivery_events(order_id, id);

create table delivery_codes (
  order_id uuid primary key references orders(id) on delete cascade,
  code_enc text not null,         -- chiffré AES-GCM, jamais journalisé
  attempts int not null default 0,
  max_attempts int not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table media (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  kind text not null check (kind in ('photo','voice','proof')),
  mime text not null,
  size int not null,
  storage_key text not null,
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table payment_obligations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  kind text not null check (kind in ('order_amount','delivery_fee','cancellation_fee')),
  payer text not null check (payer in ('merchant','customer')),
  payee text not null check (payee in ('merchant','service')),
  amount int not null check (amount >= 0),
  status text not null default 'due' check (status in ('due','declared','confirmed','rejected','waived')),
  method text check (method in ('wave','orange_money')),
  reference text,
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (order_id, kind)
);
-- Une référence de transfert ne peut confirmer qu'une seule obligation : pas de double comptabilisation.
create unique index obligations_ref_unique on payment_obligations(method, reference) where status = 'confirmed' and reference is not null;

create table payment_proofs (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references payment_obligations(id),
  media_id uuid references media(id),
  method text not null check (method in ('wave','orange_money')),
  declared_reference text not null default '',
  declared_by text not null,
  status text not null default 'to_review' check (status in ('to_review','accepted','rejected')),
  review_note text,
  created_at timestamptz not null default now()
);

create table delivery_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  kind text not null check (kind in ('code','photo')),
  media_id uuid references media(id),
  reason text,
  recipient_name text,
  status text not null check (status in ('accepted','pending_review','rejected')),
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);
create unique index proofs_one_accepted on delivery_proofs(order_id) where status = 'accepted';

create table contact_attempts (
  id serial primary key,
  order_id uuid not null references orders(id),
  courier_id uuid not null references users(id),
  channel text not null check (channel in ('call','whatsapp')),
  created_at timestamptz not null default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  type text not null check (type in ('customer_not_found','photo_proof','damaged','complaint','other')),
  reported_by text not null,
  reporter_id uuid,
  description text not null default '',
  blocking boolean not null default false,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index incidents_one_blocking on incidents(order_id) where blocking and status = 'open';

create table cancellations (
  order_id uuid primary key references orders(id),
  actor text not null,
  actor_id uuid,
  reason text not null,
  fee int not null default 0,
  courier_compensation int not null default 0,
  refund_decision text not null default 'none' check (refund_decision in ('none','to_refund','refunded','not_applicable')),
  refund_note text,
  created_at timestamptz not null default now()
);

create table payouts (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references users(id),
  amount int not null check (amount > 0),
  method text not null check (method in ('wave','orange_money')),
  reference text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique (method, reference)
);

create table earnings (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references users(id),
  order_id uuid references orders(id),
  kind text not null check (kind in ('delivery','cancellation','adjustment')),
  amount int not null,
  note text,
  status text not null default 'pending' check (status in ('pending','paid')),
  payout_id uuid references payouts(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
-- Pas de double gain pour une même course.
create unique index earnings_once on earnings(order_id, kind) where kind in ('delivery','cancellation');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  template text not null,
  lang text not null default 'fr',
  recipient_kind text not null check (recipient_kind in ('customer','merchant','courier')),
  recipient_phone text not null,
  body text not null,
  channel text not null check (channel in ('whatsapp_manual','whatsapp_api')),
  -- prepared : prêt · opened : lien ouvert (PAS envoyé) · confirmed_sent : envoi confirmé par l'opérateur
  status text not null default 'prepared' check (status in ('prepared','opened','confirmed_sent','sent','delivered','failed')),
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  actor_id uuid,
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Tâches différées rejouables sans doublon (récap quotidien, purge médias…).
create table job_runs (
  key text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb
);
