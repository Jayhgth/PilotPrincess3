-- Source-backed MVP seed. All rows below are derived from official d.tech
-- 2025-26 documents linked from https://www.designtechhighschool.org/graduation.

insert into public.schools (id, slug, name, short_name, website_url, source_year)
values (
  'd7ec0000-0000-4000-8000-000000000001',
  'design-tech-high-school',
  'Design Tech High School',
  'd.tech',
  'https://www.designtechhighschool.org',
  '2025-26'
)
on conflict (slug) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  website_url = excluded.website_url,
  source_year = excluded.source_year;

insert into public.official_sources (
  id, school_id, title, kind, source_url, source_year, is_official, parse_status, confidence
)
values
  (
    'd7ec1000-0000-4000-8000-000000000001',
    'd7ec0000-0000-4000-8000-000000000001',
    '25/26 Graduation Requirements',
    'official_url',
    'https://docs.google.com/document/d/1N351ZQzwGakGiFf5ax7i7NE1BEA2k_civOL9atMWXJo/edit',
    '2025-26',
    true,
    'complete',
    'verified'
  ),
  (
    'd7ec1000-0000-4000-8000-000000000002',
    'd7ec0000-0000-4000-8000-000000000001',
    '2526 Course Catalog Public',
    'official_url',
    'https://docs.google.com/spreadsheets/d/11iRo_SuYTb0_WxaZ2vB1H3L9qtT0Ecbmkj960XvCuB4/edit',
    '2025-26',
    true,
    'complete',
    'verified'
  ),
  (
    'd7ec1000-0000-4000-8000-000000000003',
    'd7ec0000-0000-4000-8000-000000000001',
    '23/24 Flow of Classes',
    'official_url',
    'https://docs.google.com/document/d/1dX4WLEyikPmDjZVWMF3sIYjwGiwmCmSZRYfbdywiQuM/edit',
    '2023-24',
    true,
    'complete',
    'verified'
  ),
  (
    'd7ec1000-0000-4000-8000-000000000004',
    'd7ec0000-0000-4000-8000-000000000001',
    '24/25 Concurrent Enrollment Policy',
    'official_url',
    'https://docs.google.com/presentation/d/1cVyDYDya2lGkOymkEbmWaNpjOYkn8iBBCGpowiL4xhI/edit',
    '2024-25',
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

insert into public.catalog_versions (
  id, school_id, source_id, label, academic_year, is_current, published_at
)
values (
  'd7ec2000-0000-4000-8000-000000000001',
  'd7ec0000-0000-4000-8000-000000000001',
  'd7ec1000-0000-4000-8000-000000000002',
  'Official d.tech course catalog',
  '2025-26',
  true,
  '2025-07-01'
)
on conflict (school_id, academic_year) do update set
  label = excluded.label,
  source_id = excluded.source_id,
  is_current = excluded.is_current;

insert into public.graduation_requirements (
  school_id, catalog_version_id, source_id, area, name, credits_required,
  years_required, notes, confidence, review_status
)
values
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'english', 'English', 40, 4, 'English 1 through English 4. Honors options are available in grades 10-12.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'social_science', 'Social Science', 30, 3, 'Ethnic Studies, World History, US History, Government, and Economics.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'math', 'Mathematics', 30, 3, 'Algebra I, Geometry, Algebra II and Trigonometry, and advanced options.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'lab_science', 'Laboratory Science', 30, 3, 'Must include one year of physical science, one year of biological science, and a third year in either area.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'world_language', 'World Language', 20, 2, 'Spanish sequence or an approved equivalent.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'design_lab', 'Design Lab', 40, 4, 'Foundations, Co-designers, and upper-division Design Lab pathways.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'visual_performing_arts', 'Visual and Performing Arts', 10, 1, 'One year of an approved visual or performing arts course.', 'verified', 'approved'),
  ('d7ec0000-0000-4000-8000-000000000001', 'd7ec2000-0000-4000-8000-000000000001', 'd7ec1000-0000-4000-8000-000000000001', 'personal_development', 'Personal Development', 25, 2.5, 'Intersession electives and Introduction to Prototyping and Fabrication contribute to this requirement.', 'verified', 'approved')
on conflict (catalog_version_id, area) do update set
  name = excluded.name,
  credits_required = excluded.credits_required,
  years_required = excluded.years_required,
  notes = excluded.notes,
  confidence = excluded.confidence,
  review_status = excluded.review_status;

insert into public.courses (
  school_id, catalog_version_id, source_id, name, subject, grade_levels, credits,
  term_type, uc_ag_area, prerequisites, description, is_honors, is_weighted,
  confidence, review_status
)
values
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Ethnic Studies','Social Science',array[9],10,'year','A (History)',array[]::text[],'Interdisciplinary study of United States communities, identity, struggle, resilience, and civic engagement.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','World History','Social Science',array[10],10,'year','A (History)',array[]::text[],'Modern world history through primary sources, scholarly research, debate, and historical reasoning.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','US History / US History Honors','Social Science',array[11],10,'year','A (History)',array[]::text[],'United States history from 1860 to the present with an optional honors portfolio and extended learning.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Government','Social Science',array[12],5,'semester','A (History)',array[]::text[],'Fall course covering the Constitution, federalism, media, elections, civil liberties, and civil rights.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Economics','Social Science',array[12],5,'semester','G (College Preparatory Elective)',array[]::text[],'Spring course covering economic systems, markets, public policy, and personal finance.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','English 1','English',array[9],10,'year','B (English)',array[]::text[],'Foundational reading, writing, oral language, critical thinking, literature, and descriptive composition.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','English 2 / English 2 Honors','English',array[10],10,'year','B (English)',array['English 1'],'Rhetoric, persuasion, literary analysis, debate, and an optional honors pathway.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','English 3 / English 3 Honors','English',array[11],10,'year','B (English)',array['English 2'],'Long-form writing, narrative structure, drafting, peer feedback, and revision.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','English 4 / English 4 Honors','English',array[12],10,'year','B (English)',array['English 3'],'Senior English with literary lenses, evidence-based analysis, screenplays, video essays, and presentations.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Algebra 1','Mathematics',array[9],10,'year','C (Mathematics)',array[]::text[],'Expressions, functions, factoring, graphical analysis, and algebraic reasoning.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Geometry / Geometry Honors','Mathematics',array[9,10],10,'year','C (Mathematics)',array['Algebra 1'],'Euclidean geometry, spatial reasoning, transformations, proof, area, volume, and trigonometry foundations.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Algebra 2 / Algebra 2-Trigonometry Honors','Mathematics',array[10,11],10,'year','C (Mathematics)',array['Geometry'],'Quadratics, radicals, rational, exponential, logarithmic, and trigonometric functions.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Algebra 2 + Pre-Calculus Honors','Mathematics',array[10,11],10,'year',null,array['Geometry'],'Compressed Algebra 2 and Precalculus pathway. The official catalog marks approval as pending.',true,true,'likely','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Precalculus','Mathematics',array[10,11,12],10,'year','C (Mathematics)',array['Algebra 2'],'Functions, trigonometry, prediction, justification, and mathematical communication.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Precalculus Honors','Mathematics',array[10,11,12],10,'year','C (Mathematics)',array['Algebra 2 / Trigonometry Honors'],'Honors precalculus with additional depth and a culminating exam or project.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Calculus / Calculus Honors','Mathematics',array[11,12],10,'year','C (Mathematics)',array['Precalculus'],'Limits, derivatives, integrals, optimization, related rates, differential equations, area, and volume.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Advanced Statistics / Advanced Statistics Honors','Mathematics',array[11,12],10,'year','C (Mathematics)',array['Algebra 2'],'Data displays, regression, experimental design, probability, random variables, and inference.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Discrete Math for Computer Science Honors','Mathematics',array[11,12],10,'year','C (Mathematics)',array['Precalculus co-requisite'],'Logic, sets, proof, combinatorics, recursion, graph theory, and algorithms. This is not a coding class.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Topics in Applied Math Honors','Mathematics',array[11,12],10,'year',null,array['Precalculus co-requisite'],'Applied linear algebra and discrete mathematics. The official catalog notes anticipated approval.',true,true,'likely','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Environmental Science','Laboratory Science',array[9],10,'year','D (Laboratory Science)',array[]::text[],'Natural systems, climate, pollution, biodiversity, conservation, and environmental policy.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Physics','Laboratory Science',array[9],10,'year','D (Laboratory Science)',array[]::text[],'Mechanics, momentum, energy, electricity, magnetism, waves, light, and laboratory practice.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Chemistry / Chemistry Honors','Laboratory Science',array[10],10,'year','D (Laboratory Science)',array[]::text[],'Atomic structure, bonding, reactions, stoichiometry, gases, thermochemistry, and equilibrium.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Biology / Biology Honors','Laboratory Science',array[11],10,'year','D (Laboratory Science)',array[]::text[],'NGSS-aligned life science through inquiry, laboratories, and optional honors challenges.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Advanced Environmental Science Honors','Laboratory Science',array[10,11,12],10,'year','D (Laboratory Science)',array[]::text[],'Advanced environmental systems with laboratory work, fieldwork, case studies, and data analysis.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Advanced Physics Honors','Laboratory Science',array[11,12],10,'year','D (Laboratory Science)',array['Algebra 2','Precalculus preferred'],'College-level mechanics, forces, energy, static electricity, and waves.',true,true,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Engineering','Laboratory Science',array[11,12],10,'year','D (Laboratory Science)',array['Algebra 2'],'Engineering design challenges progressing toward an open-ended real-world project.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Spanish 1','World Language',array[9],10,'year','E (Language Other Than English)',array[]::text[],'Foundational interpersonal, presentational, and interpretive communication in Spanish.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Spanish 2','World Language',array[9,10],10,'year','E (Language Other Than English)',array['Spanish 1'],'Second-year speaking, reading, listening, writing, grammar, and cultural study.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Spanish 3','World Language',array[10,11],10,'year','E (Language Other Than English)',array['Spanish 2'],'Intermediate communication, formal presentation, synthesis writing, audio, and literary analysis.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Spanish 4','World Language',array[11,12],10,'year',null,array['Spanish 3'],'Advanced intermediate communication, debate, presentation, synthesis, and cultural analysis.',false,false,'likely','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Introduction to Visual Art','Visual and Performing Arts',array[10],10,'year','F (Visual and Performing Arts)',array[]::text[],'Drawing, painting, color theory, perspective, composition, terminology, evaluation, and critique.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Introduction to Prototyping and Fabrication','Personal Development',array[9],10,'year',null,array[]::text[],'Physical and digital prototyping, workshop safety, design methods, self-direction, and belonging.',false,false,'likely','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Foundation in Design Thinking','Design Lab',array[9],10,'year','G (College Preparatory Elective)',array[]::text[],'Human-centered design, research, prototyping, testing, ethics, collaboration, and project management.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Co-designers','Design Lab',array[10],10,'year','G (College Preparatory Elective)',array['Foundation in Design Thinking'],'Design thinking and creativity pre-apprenticeship with youth-facing co-design projects.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Innovation Diploma','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Year-long UN Sustainable Development Goal project with design reviews and a final defense.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Game Narration','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Board games, text games, narrative escape rooms, scripting, and purposeful game mechanics.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Cozy Game Design and Development','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Game mechanics, narrative, art, animation, scripting, and team game production.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Maker Space Design','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Design-thinking projects that improve makerspace access, efficiency, usefulness, and capability.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Art and Design','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Visual art and design thinking applied to researched social issues and community needs.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Craftivism','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Craft practices including sewing, embroidery, and crochet applied to social issues.',false,false,'verified','approved'),
  ('d7ec0000-0000-4000-8000-000000000001','d7ec2000-0000-4000-8000-000000000001','d7ec1000-0000-4000-8000-000000000002','Leadership','Design Lab',array[11,12],10,'year',null,array['Co-designers'],'Event planning, communication, teamwork, logistics, budgeting, marketing, and inclusive leadership.',false,false,'verified','approved')
on conflict (catalog_version_id, name) do update set
  subject = excluded.subject,
  grade_levels = excluded.grade_levels,
  credits = excluded.credits,
  term_type = excluded.term_type,
  uc_ag_area = excluded.uc_ag_area,
  prerequisites = excluded.prerequisites,
  description = excluded.description,
  is_honors = excluded.is_honors,
  is_weighted = excluded.is_weighted,
  confidence = excluded.confidence,
  review_status = excluded.review_status;

insert into public.course_requirement_mappings (course_id, requirement_id, source_id, confidence)
select
  course.id,
  requirement.id,
  'd7ec1000-0000-4000-8000-000000000001',
  case
    when requirement.area in (
      'design_lab'::public.requirement_area,
      'personal_development'::public.requirement_area
    ) then 'verified'::public.confidence_status
    when course.confidence = 'verified' and requirement.confidence = 'verified' then 'verified'::public.confidence_status
    else 'likely'::public.confidence_status
  end
from public.courses course
join public.graduation_requirements requirement
  on requirement.catalog_version_id = course.catalog_version_id
 and requirement.area = case course.subject
    when 'English' then 'english'::public.requirement_area
    when 'Social Science' then 'social_science'::public.requirement_area
    when 'Mathematics' then 'math'::public.requirement_area
    when 'Laboratory Science' then 'lab_science'::public.requirement_area
    when 'World Language' then 'world_language'::public.requirement_area
    when 'Design Lab' then 'design_lab'::public.requirement_area
    when 'Visual and Performing Arts' then 'visual_performing_arts'::public.requirement_area
    when 'Personal Development' then 'personal_development'::public.requirement_area
  end
where course.catalog_version_id = 'd7ec2000-0000-4000-8000-000000000001'
on conflict (course_id, requirement_id) do update set
  confidence = excluded.confidence,
  source_id = excluded.source_id;
