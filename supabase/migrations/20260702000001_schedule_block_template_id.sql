-- Link each template-generated schedule_block back to the block_template that
-- created it, so edits and deletes to a saved block can reliably find (and
-- rebuild) its upcoming calendar copies. Nullable; ON DELETE SET NULL so that
-- deleting a template leaves any retained (past) copies intact with a null link.
alter table public.schedule_blocks
  add column if not exists template_id uuid references public.block_templates(id) on delete set null;
