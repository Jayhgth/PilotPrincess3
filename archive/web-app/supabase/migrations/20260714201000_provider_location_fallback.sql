-- CDE occasionally omits coordinates. Preserve statewide district discovery by
-- falling back from exact ZIP/city to the three-digit ZIP region; never use a
-- student's device location and never present the fallback as mileage.

create or replace function public.nearby_school_providers(
  target_school_id uuid,
  result_limit integer default 8
)
returns table (
  provider_id uuid,
  provider_code text,
  name text,
  provider_type text,
  city text,
  postal_code text,
  website_url text,
  distance_miles numeric,
  relationship_type text,
  confidence public.confidence_status
)
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_school as (
    select school.id, school.latitude, school.longitude, school.city, school.postal_code
    from public.schools school where school.id = target_school_id
  ), candidates as (
    select
      provider.id,
      provider.provider_code,
      provider.name,
      provider.provider_type,
      provider.city,
      provider.postal_code,
      provider.website_url,
      link.relationship_type,
      coalesce(link.confidence, 'uncertain'::public.confidence_status) as confidence,
      coalesce(
        link.distance_miles,
        case when school.latitude is not null and provider.latitude is not null then
          3958.7613 * acos(least(1, greatest(-1,
            sin(radians(school.latitude::double precision)) * sin(radians(provider.latitude::double precision))
            + cos(radians(school.latitude::double precision)) * cos(radians(provider.latitude::double precision))
            * cos(radians(provider.longitude::double precision - school.longitude::double precision))
          ))) else null end
      )::numeric(7,2) as distance_miles,
      case
        when link.id is not null then 0
        when school.latitude is not null and provider.latitude is not null then 1
        when school.postal_code is not null and provider.postal_code = school.postal_code then 2
        when school.city is not null and lower(provider.city) = lower(school.city) then 3
        when school.postal_code is not null and left(provider.postal_code, 3) = left(school.postal_code, 3) then 4
        else 5
      end as proximity_tier
    from selected_school school
    join public.education_providers provider on provider.status = 'active'
    left join public.school_provider_links link
      on link.school_id = school.id and link.provider_id = provider.id and link.review_status = 'approved'
  )
  select
    candidates.id,
    candidates.provider_code,
    candidates.name,
    candidates.provider_type,
    candidates.city,
    candidates.postal_code,
    candidates.website_url,
    candidates.distance_miles,
    coalesce(candidates.relationship_type, 'nearby'),
    candidates.confidence
  from candidates
  where candidates.proximity_tier < 5
  order by candidates.proximity_tier, candidates.distance_miles nulls last, candidates.name
  limit least(greatest(result_limit, 1), 20);
$$;

create or replace function public.nearby_college_districts(
  target_school_id uuid,
  result_limit integer default 8
)
returns table (
  district_code text,
  district_name text,
  colleges_count bigint,
  nearest_distance_miles numeric,
  providers jsonb,
  is_recommended boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_school as (
    select school.latitude, school.longitude, school.city, school.postal_code
    from public.schools school where school.id = target_school_id
  ), provider_candidates as (
    select
      provider.*,
      case when school.latitude is not null and provider.latitude is not null then
        (3958.7613 * acos(least(1, greatest(-1,
          sin(radians(school.latitude::double precision)) * sin(radians(provider.latitude::double precision))
          + cos(radians(school.latitude::double precision)) * cos(radians(provider.latitude::double precision))
          * cos(radians(provider.longitude::double precision - school.longitude::double precision))
        ))))::numeric(7,2) else null end as distance_miles,
      case
        when school.latitude is not null and provider.latitude is not null then 1
        when school.postal_code is not null and provider.postal_code = school.postal_code then 2
        when school.city is not null and lower(provider.city) = lower(school.city) then 3
        when school.postal_code is not null and left(provider.postal_code, 3) = left(school.postal_code, 3) then 4
        else 5
      end as proximity_tier
    from selected_school school
    join public.education_providers provider
      on provider.status = 'active'
      and provider.provider_type = 'community_college'
      and provider.district_code is not null
  ), grouped as (
    select
      provider.district_code,
      district.name as district_name,
      count(*) as colleges_count,
      min(provider.distance_miles) as nearest_distance_miles,
      min(provider.proximity_tier) as proximity_tier,
      jsonb_agg(jsonb_build_object(
        'id', provider.id,
        'provider_code', provider.provider_code,
        'name', provider.name,
        'website_url', provider.website_url,
        'city', provider.city,
        'postal_code', provider.postal_code,
        'distance_miles', provider.distance_miles
      ) order by provider.distance_miles nulls last, provider.name) as providers
    from provider_candidates provider
    join public.college_districts district on district.district_code = provider.district_code and district.status = 'active'
    where provider.proximity_tier < 5
    group by provider.district_code, district.name
  ), ranked as (
    select grouped.*, row_number() over (order by grouped.proximity_tier, grouped.nearest_distance_miles nulls last, grouped.district_name) as position
    from grouped
  )
  select ranked.district_code, ranked.district_name, ranked.colleges_count,
    ranked.nearest_distance_miles, ranked.providers, ranked.position = 1
  from ranked
  order by ranked.position
  limit least(greatest(result_limit, 1), 20);
$$;

grant execute on function public.nearby_school_providers(uuid, integer) to authenticated;
grant execute on function public.nearby_college_districts(uuid, integer) to authenticated;
