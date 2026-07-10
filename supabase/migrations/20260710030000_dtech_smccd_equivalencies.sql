-- Generated from supabase/catalog/dtech-smccd-equivalencies-2021.json.
-- The source is an official d.tech sheet last updated April 26, 2021.

insert into public.official_sources (
  id, school_id, title, kind, source_url, source_year, is_official, parse_status, confidence
)
values (
  'd7ec1000-0000-4000-8000-000000000005',
  'd7ec0000-0000-4000-8000-000000000001',
  'd.tech SMCCD College Equivalency Chart',
  'official_url',
  'https://docs.google.com/spreadsheets/d/1DShfEovBYe-N9VlR1QM6Pyy3pmJ4cMMc6bE91QUzLIw/edit?gid=0#gid=0',
  '2021',
  true,
  'complete',
  'verified'
)
on conflict (id) do update set
  title = excluded.title,
  source_url = excluded.source_url,
  source_year = excluded.source_year,
  parse_status = excluded.parse_status,
  confidence = excluded.confidence;

create table if not exists public.smccd_high_school_equivalencies (
  normalized_course_code text primary key,
  college_course_code text not null,
  description text not null,
  college_units numeric(5,2) not null check (college_units > 0),
  high_school_credits numeric(6,2) not null check (high_school_credits > 0),
  high_school_equivalent text not null,
  requirement_area public.requirement_area not null,
  pairing_note text,
  source_id uuid not null references public.official_sources(id) on delete restrict,
  confidence public.confidence_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.smccd_high_school_equivalencies is
  'Exact SMCCD-to-d.tech high-school credit conversions from the official d.tech equivalency chart. The source is visibly dated 2021 and should be counselor-confirmed for new enrollment.';

alter table public.smccd_high_school_equivalencies enable row level security;

drop policy if exists "SMCCD high-school equivalencies are readable" on public.smccd_high_school_equivalencies;
create policy "SMCCD high-school equivalencies are readable"
  on public.smccd_high_school_equivalencies for select to authenticated using (true);

insert into public.smccd_high_school_equivalencies (
  normalized_course_code, college_course_code, description, college_units,
  high_school_credits, high_school_equivalent, requirement_area, pairing_note,
  source_id, confidence
)
values
  ('MATH 130', 'Math 130', 'Trigonometry', 5, 5, 'Precalculus (fall)', 'math', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MATH 222', 'Math 222', 'Precalculus', 5, 5, 'Precalculus (spring)', 'math', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MATH 225', 'Math 225', 'Path to Calculus', 6, 10, 'Precalculus (1 Year)', 'math', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MATH 200', 'Math 200', 'Elem. Probability & Statistics', 4, 10, 'College level Statistics', 'math', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MATH 251', 'Math 251', 'Calculus w Analytic Geometry I', 5, 10, 'College level Calculus 1', 'math', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MATH 252', 'Math 252', 'Calculus W Analytic Geometry II', 5, 10, 'College level Calculus 2', 'math', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ASL 100', 'ASL 100', 'American Sign Language 1', 5, 10, 'ASL 100 meets the requirement for the 2nd year of a high school language.', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ASL 111', 'ASL 111', 'American Sign Language 1A', 3, 5, 'ASL 1 (fall)', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ASL 112', 'ASL 112', 'American Sign Language 1B', 3, 5, 'ASL 1 (spring)', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ASL 110', 'ASL 110', 'American Sign Language 2', 5, 10, 'ASL 2', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 111', 'Chinese 111', 'Elementary Chinese 1A', 3, 5, 'Mandarin 1 Fall (must take both 111 & 112 for full year credit)', 'world_language', 'Mandarin 1 Fall (must take both 111 & 112 for full year credit)', 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 112', 'Chinese 112', 'Elementary Chinese 1B', 3, 5, 'Mandarin 1 Spring (must take both 111 & 112 for full year credit)', 'world_language', 'Mandarin 1 Spring (must take both 111 & 112 for full year credit)', 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 121', 'Chinese 121', 'Adv Elem Chinese 1A', 3, 5, 'Mandarin 2 Fall', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 122', 'Chinese 122', 'Adv Elem Chinese 1B', 3, 5, 'Mandarin 2 Spring', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 131', 'Chinese 131', 'Intermediate Chinese 1', 3, 5, 'Mandarin 3 Fall', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 132', 'Chinese 132', 'Intermediate Chinese 2', 3, 5, 'Mandarin 3 Spring', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 211', 'Chinese 211', 'Colloquial Chinese 1', 3, 5, 'Mandarin 3 Fall', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHIN 212', 'Chinese 212', 'Colloquial Chinese 2', 3, 5, 'Mandarin 3 Spring', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 110', 'Spanish 110', 'Elementary Spanish 1', 5, 10, 'Spanish 1', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 111', 'Spanish 111', 'Elem Spanish 1A', 3, 5, 'Spanish 1 Fall (must take both 111 & 112)', 'world_language', 'Spanish 1 Fall (must take both 111 & 112)', 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 112', 'Spanish 112', 'Elem Spanish 1B', 3, 5, 'Spanish 2 Spring (must take both 111 & 112)', 'world_language', 'Spanish 2 Spring (must take both 111 & 112)', 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 120', 'Spanish 120', 'Adv Elementary Spanish 1', 5, 10, 'Spanish 2', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 121', 'Spanish 121', 'Adv Elem Spanish 1A', 3, 5, 'Spanish 2 Fall', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 122', 'Spanish 122', 'Adv Elem Spanish 1B', 3, 5, 'Spanish 2 Spring', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 131', 'Spanish 131', 'Intermediate Spanish 1', 3, 5, 'Spanish 3 Fall', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('SPAN 132', 'Spanish 132', 'Intermediate Spanish 2', 3, 5, 'Spanish 3 Spring', 'world_language', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('BIOL 110', 'Biology 110', 'Gen Principles of Biology', 4, 10, 'Biology', 'lab_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('CHEM 210', 'Chem. 210', 'Inc Lab General Chemistry I', 5, 10, 'Chemistry', 'lab_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('PHYS 210', 'Physics 210', 'General Physics I', 4, 10, 'Physics', 'lab_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('PHYS 220', 'Physics 220', 'General Physics II', 4, 10, 'Physics II', 'lab_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ECON 100', 'Economics 100', 'Prin of Macroeconomics', 3, 5, 'Economics', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ECON 102', 'Economics 102', 'Prin of Microeconomics', 3, 5, 'Economics', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('HIST 100', 'History 100', 'Hist of Western Civilization I', 3, 5, 'World History Fall or Spring', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('HIST 101', 'History 101', 'Hist of Western Civilization II', 3, 5, 'World History Fall or Spring', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('HIST 201', 'History 201', 'US History I', 3, 5, 'US History Fall', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('HIST 202', 'History 202', 'US History II', 3, 5, 'US History Spring', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('PLSC 200', 'Political Science 200', 'National, State & Local Governments', 5, 5, 'Government', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('PLSC 210', 'Political Science 210', 'American Politics', 3, 5, 'Government', 'social_science', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 101', 'ART 101', 'Art and Architecture from the Ancient World to Medieval Times, (c. 1400)', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 102', 'ART 102', 'Art and Architecture of Renaissance and Baroque (c. 1300-1700)', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 103', 'ART 103', 'Art of Europe and America: Neoclassicial (c. 1750 to the Present)::', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 104', 'ART 104', 'Modern Art', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 105', 'ART 105', 'Asian Art and Architecture', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 124', 'ART 124', 'Old Master''s Aesthetics and Techniques', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 129', 'ART 129', 'New Masters'' Aesthetics and Techniques', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 200', 'ART 200', 'Portfolio Preparation', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 203', 'ART 203', 'Plein Air Painting', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 204', 'ART 204', 'Drawing I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 205', 'ART 205', 'Drawing II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 206', 'ART 206', 'Expressive Figure Drawing and Portraiture', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 207', 'ART 207', 'Life Drawing', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 208', 'ART 208', 'Portrait Drawing I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 209', 'ART 209', 'Portrait Drawing II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 213', 'ART 213', 'Life Drawing II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 214', 'ART 214', 'Color', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 215', 'ART 215', 'Portraiture III', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 216', 'ART 216', 'Portraiture IV', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 223', 'ART 223', 'Oil Painting I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 224', 'ART 224', 'Oil Painting II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 225', 'ART 225', 'Acrylic Painting I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 226', 'ART 226', 'Acrylic Painting II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 230', 'ART 230', 'Expressive Figure Drawing and Portraiture II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 231', 'ART 231', 'Watercolor I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 232', 'ART 232', 'Watercolor II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 233', 'ART 233', 'Watercolor III', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 243', 'ART 243', 'Watercolor IV', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 244', 'ART 244', 'Oil Painting III', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 247', 'ART 247', 'Oil Painting IV', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 251', 'ART 251', 'Acrylic Painting III', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 252', 'ART 252', 'Acrylic Painting IV', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 253', 'ART 253', 'Plein Air Painting II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 254', 'ART 254', 'Plein Air Painting III', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 255', 'ART 255', 'Plein Air Painting IV', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 301', 'ART 301', 'Two-Dimensional Design', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 347', 'ART 347', 'The History of Photography (1900 - present)', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 348', 'ART 348', 'Photographic Composition Using Handheld Devices', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 350', 'ART 350', 'Visual Perception', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 351', 'ART 351', 'Beginning Black and White Photography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 352', 'ART 352', 'Intermediate Black and White Photography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 353', 'ART 353', 'Advanced Black and White Photography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 381', 'ART 381', 'Beginning Digital Photography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 383', 'ART 383', 'Intermediate Digital Photography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 384', 'ART 384', 'Advanced Digital Photography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 385', 'ART 385', 'Master Portfolio-Digital Photography', 3.5, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 388', 'ART 388', 'Master Photography Portfolio', 3.5, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 391', 'ART 391', 'Experimental Photography I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 392', 'ART 392', 'Experimental Photography 2', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 393', 'ART 393', 'Experimental Photography 3', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 394', 'ART 394', 'Experimental Photography 4', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 396', 'ART 396', 'Documentary Photography 1', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 397', 'ART 397', 'Documentary Photography 2', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 398', 'ART 398', 'Documentary Photography 3', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 399', 'ART 399', 'Documentary Photography 4', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 401', 'ART 401', 'Three-Dimensional Design', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 405', 'ART 405', 'Sculpture I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 406', 'ART 406', 'Sculpture II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 409', 'ART 409', 'Sculpture III-Extended Expertise', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 410', 'ART 410', 'Scultpure IV -Advanced Expression', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 411', 'ART 411', 'Ceramics I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 412', 'ART 412', 'Ceramics II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 417', 'ART 417', 'Ceramics Glaze', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('ART 418', 'ART 418', 'Ceramics III', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('DANC 390', 'DANC 390', 'Dance Composition/Theory/Choreography', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('FILM 100', 'FILM 100', 'Introduction to Film', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('FILM 120', 'FILM 120', 'Film History I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('FILM 121', 'FILM 121', 'Film History II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('FILM 200', 'FILM 200', 'Film in Focus', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('FILM 215', 'FILM 215', 'Film and New Digital Media', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 100', 'MUS. 100', 'Fundamentals of Music', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 120', 'MUS. 120', 'Songwriting', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 131', 'MUS. 131', 'Harmony I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 202', 'MUS. 202', 'Music Appreciation', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 210', 'MUS. 210', 'From Blues to Hip Hop: A History of American Popular Music', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 250', 'MUS. 250', 'World Music', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 275', 'MUS. 275', 'History of Jazz', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 280', 'MUS. 280', 'History of Electronic Music', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 290', 'MUS. 290', 'Electronic Music I', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 291', 'MUS. 291', 'Electronic Music II', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 292', 'MUS. 292', 'Sound Creation: Sampling and Synthesis', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified'),
  ('MUS 293', 'MUS. 293', 'Audio for Visual Media', 3, 10, '1 year of VAPA credit', 'visual_performing_arts', null, 'd7ec1000-0000-4000-8000-000000000005', 'verified')
on conflict (normalized_course_code) do update set
  college_course_code = excluded.college_course_code,
  description = excluded.description,
  college_units = excluded.college_units,
  high_school_credits = excluded.high_school_credits,
  high_school_equivalent = excluded.high_school_equivalent,
  requirement_area = excluded.requirement_area,
  pairing_note = excluded.pairing_note,
  source_id = excluded.source_id,
  confidence = excluded.confidence,
  updated_at = now();

-- Repair exact transcript-imported college rows so the app uses the d.tech
-- conversion instead of treating every college class as unverified credit.
update public.plan_courses plan_course
set credits = equivalency.high_school_credits,
    requirement_area_override = equivalency.requirement_area,
    mapping_verified = true,
    updated_at = now()
from public.smccd_high_school_equivalencies equivalency
where plan_course.source_review_item_id is not null
  and equivalency.normalized_course_code = coalesce(
    (
      select upper(smccd_course.course_code)
      from public.smccd_courses smccd_course
      where smccd_course.id = plan_course.smccd_course_id
    ),
    regexp_replace(
      substring(upper(coalesce(plan_course.custom_course_name, '')) from '^([A-Z]{2,5}[.]?[[:space:]]+[A-Z]?[0-9]{2,4}([.][0-9])?[A-Z]?)'),
      '^([A-Z]{2,5})[.]',
      '\1'
    )
  );
