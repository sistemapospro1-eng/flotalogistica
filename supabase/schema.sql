-- EDESUR Flota Operacion
-- Esquema base PostgreSQL/Supabase para version productiva.
-- Ejecutar en Supabase SQL Editor sobre un proyecto nuevo.

create extension if not exists "pgcrypto";

do $$ begin
  create type app_role as enum ('driver', 'admin', 'supervisor', 'maintenance', 'auditor', 'super_admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type vehicle_status as enum ('available', 'in_use', 'observed', 'out_of_service', 'maintenance', 'inactive');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type assignment_status as enum ('active', 'closed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type inspection_stage as enum ('start', 'end', 'monthly', 'maintenance');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type checklist_result as enum ('correct', 'observed', 'defective', 'missing', 'not_applicable');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type severity_level as enum ('info', 'warning', 'critical');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type incident_stage as enum ('preexisting', 'detected_at_start', 'new_at_return', 'maintenance_detected');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type incident_status as enum ('open', 'in_review', 'resolved', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type maintenance_status as enum ('pending', 'scheduled', 'in_repair', 'finished', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_number text unique not null,
  full_name text not null,
  area text,
  sector text,
  role_title text,
  location text,
  source text default 'manual',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid references employees(id),
  role app_role not null default 'driver',
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  domain text unique not null,
  internal_code text,
  model text,
  vehicle_type text,
  company text,
  fleet_type text,
  area text,
  sector text,
  responsible text,
  equipment_description text,
  year integer,
  odometer integer not null default 0,
  status vehicle_status not null default 'available',
  is_active boolean not null default true,
  source text default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  document_type text not null,
  document_number text,
  issued_at date,
  expires_at date,
  status text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_equipment (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  equipment_name text not null,
  expected boolean not null default true,
  present boolean not null default true,
  expires_at date,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vehicle_type text,
  stage inspection_stage not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  category text not null,
  label text not null,
  applies_to_vehicle_type text,
  requires_description_on checklist_result[] not null default array['observed','defective','missing']::checklist_result[],
  requires_photo_on checklist_result[] not null default array['defective','missing']::checklist_result[],
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  employee_id uuid not null references employees(id),
  started_by uuid references profiles(id),
  closed_by uuid references profiles(id),
  status assignment_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  odometer_start integer not null,
  odometer_end integer,
  distance_km integer generated always as (
    case when odometer_end is null then null else odometer_end - odometer_start end
  ) stored,
  start_location_text text,
  end_location_text text,
  start_notes text,
  end_notes text,
  accepted_at timestamptz,
  odometer_warning boolean not null default false,
  created_at timestamptz not null default now(),
  constraint odometer_end_not_lower check (odometer_end is null or odometer_end >= odometer_start)
);

create table if not exists vehicle_inspections (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references vehicle_assignments(id) on delete set null,
  vehicle_id uuid not null references vehicles(id),
  employee_id uuid references employees(id),
  template_id uuid references checklist_templates(id),
  stage inspection_stage not null,
  inspected_at timestamptz not null default now(),
  notes text,
  result severity_level not null default 'info',
  created_by uuid references profiles(id)
);

create table if not exists inspection_details (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references vehicle_inspections(id) on delete cascade,
  checklist_item_id uuid references checklist_items(id),
  category text not null,
  label text not null,
  result checklist_result not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_incidents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  assignment_id uuid references vehicle_assignments(id),
  inspection_id uuid references vehicle_inspections(id),
  reported_by uuid references profiles(id),
  stage incident_stage not null,
  title text not null,
  description text,
  severity severity_level not null default 'warning',
  status incident_status not null default 'open',
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  incident_id uuid references vehicle_incidents(id),
  status maintenance_status not null default 'pending',
  maintenance_type text,
  provider text,
  workshop text,
  detail text not null,
  cost numeric(12,2),
  entered_at date,
  retired_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  assignment_id uuid references vehicle_assignments(id),
  inspection_id uuid references vehicle_inspections(id),
  incident_id uuid references vehicle_incidents(id),
  storage_bucket text not null default 'vehicle-evidence',
  storage_path text not null,
  photo_type text not null,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id),
  assignment_id uuid references vehicle_assignments(id),
  incident_id uuid references vehicle_incidents(id),
  alert_type text not null,
  severity severity_level not null default 'warning',
  title text not null,
  description text,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  provider text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  accuracy_meters numeric(10,2),
  odometer integer,
  recorded_at timestamptz not null,
  raw_payload jsonb
);

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_type text not null,
  source_kind text not null,
  status text not null default 'analyzed',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  incomplete_rows integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  imported_at timestamptz
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_name text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists employees_set_updated_at on employees;
create trigger employees_set_updated_at before update on employees
for each row execute function set_updated_at();

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at before update on profiles
for each row execute function set_updated_at();

drop trigger if exists vehicles_set_updated_at on vehicles;
create trigger vehicles_set_updated_at before update on vehicles
for each row execute function set_updated_at();

drop trigger if exists maintenance_set_updated_at on maintenance_records;
create trigger maintenance_set_updated_at before update on maintenance_records
for each row execute function set_updated_at();

create or replace function current_app_role()
returns app_role as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

create or replace function is_admin_like()
returns boolean as $$
  select current_app_role() in ('admin', 'super_admin');
$$ language sql stable security definer;

create or replace function is_readonly_admin_like()
returns boolean as $$
  select current_app_role() in ('admin', 'super_admin', 'supervisor', 'maintenance', 'auditor');
$$ language sql stable security definer;

alter table employees enable row level security;
alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table vehicle_documents enable row level security;
alter table vehicle_equipment enable row level security;
alter table checklist_templates enable row level security;
alter table checklist_items enable row level security;
alter table vehicle_assignments enable row level security;
alter table vehicle_inspections enable row level security;
alter table inspection_details enable row level security;
alter table vehicle_incidents enable row level security;
alter table maintenance_records enable row level security;
alter table vehicle_photos enable row level security;
alter table alerts enable row level security;
alter table locations enable row level security;
alter table import_batches enable row level security;
alter table audit_logs enable row level security;

create policy "profiles read own or admin" on profiles
for select using (id = auth.uid() or is_readonly_admin_like());

create policy "employees read authenticated" on employees
for select using (auth.role() = 'authenticated');

create policy "vehicles read authenticated" on vehicles
for select using (auth.role() = 'authenticated');

create policy "vehicles write admin" on vehicles
for all using (is_admin_like()) with check (is_admin_like());

create policy "drivers create own assignments" on vehicle_assignments
for insert with check (auth.role() = 'authenticated');

create policy "assignments read authenticated" on vehicle_assignments
for select using (auth.role() = 'authenticated');

create policy "assignments update owner or admin" on vehicle_assignments
for update using (
  is_admin_like()
  or employee_id in (select employee_id from profiles where id = auth.uid())
) with check (
  is_admin_like()
  or employee_id in (select employee_id from profiles where id = auth.uid())
);

create policy "inspections read authenticated" on vehicle_inspections
for select using (auth.role() = 'authenticated');

create policy "inspections write authenticated" on vehicle_inspections
for insert with check (auth.role() = 'authenticated');

create policy "inspection details read authenticated" on inspection_details
for select using (auth.role() = 'authenticated');

create policy "inspection details write authenticated" on inspection_details
for insert with check (auth.role() = 'authenticated');

create policy "incidents read authenticated" on vehicle_incidents
for select using (auth.role() = 'authenticated');

create policy "incidents write authenticated" on vehicle_incidents
for insert with check (auth.role() = 'authenticated');

create policy "maintenance read authorized" on maintenance_records
for select using (is_readonly_admin_like());

create policy "maintenance write maintenance or admin" on maintenance_records
for all using (current_app_role() in ('admin', 'super_admin', 'maintenance')) with check (current_app_role() in ('admin', 'super_admin', 'maintenance'));

create policy "alerts read authenticated" on alerts
for select using (auth.role() = 'authenticated');

create policy "audit read admin auditor" on audit_logs
for select using (current_app_role() in ('admin', 'super_admin', 'auditor'));

create index if not exists idx_vehicles_domain on vehicles(domain);
create index if not exists idx_assignments_vehicle on vehicle_assignments(vehicle_id);
create index if not exists idx_assignments_employee on vehicle_assignments(employee_id);
create index if not exists idx_assignments_status on vehicle_assignments(status);
create index if not exists idx_incidents_vehicle_status on vehicle_incidents(vehicle_id, status);
create index if not exists idx_maintenance_vehicle_status on maintenance_records(vehicle_id, status);
create index if not exists idx_alerts_open on alerts(is_open, severity);
