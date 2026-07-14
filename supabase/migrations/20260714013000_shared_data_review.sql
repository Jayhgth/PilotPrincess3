-- Students and Pilot can submit corrections, but only an app administrator can
-- publish an allowlisted patch to shared institutional records.

create policy "Students can withdraw their pending shared proposals"
on public.shared_data_proposals for delete
to authenticated
using (submitted_by = (select auth.uid()) and status = 'pending');

create or replace function public.review_shared_data_proposal(
  proposal_id uuid,
  decision text,
  note text default null
)
returns public.shared_data_proposals
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.shared_data_proposals;
  allowed_columns text[];
  proposed_columns text[];
  column_list text;
  changed_rows integer;
begin
  if not public.is_app_admin() then
    raise exception 'Administrator access required.';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into proposal
  from public.shared_data_proposals
  where id = proposal_id
  for update;

  if proposal.id is null then raise exception 'Shared-data proposal not found.'; end if;
  if proposal.status <> 'pending' then raise exception 'This proposal has already been reviewed.'; end if;
  if proposal.action <> 'correct' then raise exception 'Only correction proposals can be published by this review function.'; end if;

  if decision = 'approved' then
    allowed_columns := case proposal.target_table
      when 'schools' then array['name','short_name','website_url','district_name','county_name','governance_type','charter_number','status','school_type','street_address','city','postal_code','uc_ag_institution_id','directory_source_url']
      when 'courses' then array['course_code','name','subject','course_type','grade_levels','credits','college_units','term_type','uc_ag_area','prerequisites','description','is_honors','is_weighted','confidence','review_status']
      when 'course_framework_mappings' then array['requirement_rule_id','source_url','confidence','review_status']
      when 'academic_requirement_rules' then array['subject_area','title','credits_required','years_required','courses_required','minimum_grade','required_before_grade','effective_graduation_year_start','effective_graduation_year_end','notes','sort_order']
      when 'education_providers' then array['district_name','name','website_url','street_address','city','postal_code','status','source_url']
      when 'school_provider_links' then array['relationship_type','distance_miles','source_url','confidence','review_status']
      else null
    end;
    if allowed_columns is null then raise exception 'Target table is not publishable.'; end if;

    select array_agg(key order by key), string_agg(format('%I', key), ', ' order by key)
    into proposed_columns, column_list
    from jsonb_object_keys(proposal.proposed_payload) as key;
    if proposed_columns is null or cardinality(proposed_columns) = 0 then raise exception 'Proposal has no corrected fields.'; end if;
    if not proposed_columns <@ allowed_columns then raise exception 'Proposal contains a field outside the publish allowlist.'; end if;

    execute format(
      'update public.%I as target set (%s) = (select %s from jsonb_populate_record(target, $1) as patched) where target.id = $2',
      proposal.target_table,
      column_list,
      (select string_agg(format('patched.%I', value), ', ' order by value) from unnest(proposed_columns) value)
    ) using proposal.proposed_payload, proposal.target_id;
    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then raise exception 'The proposed shared record no longer exists.'; end if;

    if exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = format('public.%I', proposal.target_table)::regclass
        and attname = 'updated_at' and not attisdropped
    ) then
      execute format('update public.%I set updated_at = now() where id = $1', proposal.target_table) using proposal.target_id;
    end if;
  end if;

  update public.shared_data_proposals
  set status = decision::public.review_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(note), ''),
      updated_at = now()
  where id = proposal.id
  returning * into proposal;

  return proposal;
end;
$$;

revoke all on function public.review_shared_data_proposal(uuid, text, text) from public;
grant execute on function public.review_shared_data_proposal(uuid, text, text) to authenticated;
