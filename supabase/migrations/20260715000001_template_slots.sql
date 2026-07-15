-- Multi-slot saved blocks: a template owns a LIST of time slots (JSONB) and
-- each stamped calendar copy records which slot it came from plus a
-- `customized` tag that lets one-off day tweaks survive template rebuilds.
-- See docs/superpowers/specs/2026-07-15-multi-slot-saved-blocks-design.md.

alter table public.block_templates
  add column if not exists slots jsonb not null default '[]';

alter table public.schedule_blocks
  add column if not exists slot_id uuid;

alter table public.schedule_blocks
  add column if not exists customized boolean not null default false;

-- Convert each template's old single default_start_time into a one-slot list.
update public.block_templates
set slots = jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(),
      'start_time', default_start_time,
      'duration_minutes', duration_minutes))
where default_start_time is not null
  and slots = '[]'::jsonb;

-- Point existing stamped copies at their template's single migrated slot.
-- Unambiguous: the update above creates exactly one slot per template.
update public.schedule_blocks b
set slot_id = (t.slots->0->>'id')::uuid
from public.block_templates t
where b.template_id = t.id
  and b.slot_id is null
  and jsonb_array_length(t.slots) > 0;

-- Superseded by slots.
alter table public.block_templates
  drop column if exists default_start_time;
