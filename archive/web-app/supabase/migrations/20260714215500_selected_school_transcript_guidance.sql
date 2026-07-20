update public.ai_knowledge_chunks
set content = 'Transcript-backed completed courses are evidence records and cannot be moved or removed as ordinary rows. High-school transcript matching must load only the transcript source''s selected-school catalog and weighting evidence. d.tech''s layout, intersession, and printed-Honors rules apply only to d.tech; never relabel another school''s course as d.tech or borrow another school''s weighting. Preserve uncertain fields for student review. Every selected-school catalog addition must pass duplicate, published grade-window, sequence, and prerequisite checks using that school''s own official data. Catalog inclusion never proves a live section, seat, schedule fit, counselor approval, or award eligibility.',
    tags = array['courses', 'transcript', 'college', 'school', 'prerequisites'],
    updated_at = now()
where id = 'course-and-transcript-integrity';
