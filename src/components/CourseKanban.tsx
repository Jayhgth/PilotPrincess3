import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  DotsSixVerticalIcon as DotsSixVertical,
  HandGrabbingIcon as HandGrabbing,
  ListPlusIcon as ListPlus,
  LockKeyIcon as LockKey,
  PencilSimpleIcon as PencilSimple,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import {
  compareCourseBoardRows,
  courseAppearsInBoardTerm,
  courseBoardTermsForGrade,
  isCollegePlanCourse,
  isPassFailPlanCourse,
  type CourseBoardTerm
} from "@/lib/course-board";
import { INSTITUTIONS } from "@/lib/institutions";
import { courseDisplayName, GRADE_LEVELS, LETTER_GRADES, REQUIREMENT_LABELS, schoolYearForGrade } from "@/lib/planning";
import type { Course, CourseStatus, GradeLevel, PlanCourse, SmccdCourse, StudentSettings } from "@/lib/models";

const TERM_CONTENT: Record<CourseBoardTerm, { label: string; description: string }> = {
  fall: { label: "Fall", description: "Full-year classes begin here" },
  spring: { label: "Spring", description: "Second semester" },
  summer: { label: "Summer", description: "Before the next grade" }
};

export interface CoursePlacement {
  gradeLevel: GradeLevel;
  term: PlanCourse["term"];
  status: CourseStatus;
}

function formatCredits(value: number) {
  return `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)} cr`;
}

function termLabel(term: PlanCourse["term"]) {
  return term === "full_year" ? "Full year" : term[0].toUpperCase() + term.slice(1);
}

interface CourseKanbanProps {
  rows: PlanCourse[];
  courses: Course[];
  smccdCourses: SmccdCourse[];
  settings: StudentSettings;
  editingCourseId: string | null;
  busy: boolean;
  onEditingChange: (id: string | null) => void;
  onMove: (row: PlanCourse, placement: CoursePlacement) => void;
  onUpdate: (id: string, patch: Partial<PlanCourse>) => void;
  onRemove: (id: string) => void;
  onGeneratePlan: () => void;
}

interface CourseCardProps {
  row: PlanCourse;
  courseMap: Map<string, Course>;
  smccdCourseMap: Map<string, SmccdCourse>;
  settings: StudentSettings;
  sectionLocked: boolean;
  continuation?: boolean;
  editing: boolean;
  busy: boolean;
  onEditingChange: (id: string | null) => void;
  onMove: (row: PlanCourse, placement: CoursePlacement) => void;
  onUpdate: (id: string, patch: Partial<PlanCourse>) => void;
  onRemove: (id: string) => void;
}

type DragBindings = Pick<ReturnType<typeof useDraggable>, "attributes" | "listeners" | "setNodeRef" | "isDragging">;

function CourseCard(props: CourseCardProps) {
  if (props.continuation) return <CourseCardBody {...props} locked continuation />;
  const locked = props.sectionLocked || props.row.status === "completed" || Boolean(props.row.source_review_item_id);
  return locked
    ? <CourseCardBody {...props} locked />
    : <DraggableCourseCard {...props} />;
}

function DraggableCourseCard(props: CourseCardProps) {
  const drag = useDraggable({
    id: props.row.id,
    disabled: props.busy || props.editing,
    data: { row: props.row }
  });
  return <CourseCardBody {...props} locked={false} drag={drag} />;
}

function CourseCardBody({
  row,
  courseMap,
  smccdCourseMap,
  settings,
  editing,
  onEditingChange,
  onMove,
  onUpdate,
  onRemove,
  locked,
  continuation = false,
  drag
}: CourseCardProps & { locked: boolean; drag?: DragBindings }) {
  const { attributes, listeners, setNodeRef, isDragging = false } = drag ?? {};
  const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
  const isSmccd = isCollegePlanCourse(row);
  const smccdCourse = row.smccd_course_id ? smccdCourseMap.get(row.smccd_course_id) : null;
  const institution = smccdCourse?.college_code ?? (isSmccd ? "smccd" : null);
  const weighted = isSmccd || row.is_weighted;
  const isPassFail = isPassFailPlanCourse(row);
  const title = courseDisplayName(row, courseMap);
  const currentGrade = (settings.grade_level ?? 9) as GradeLevel;
  const metadata = [
    termLabel(row.term),
    row.credits ? formatCredits(Number(row.credits)) : "Credits need review",
    isSmccd ? null : catalogCourse?.subject ?? (row.requirement_area_override ? REQUIREMENT_LABELS[row.requirement_area_override] : "Custom"),
    weighted ? "Weighted" : null,
    isPassFail ? "Pass/fail, outside GPA" : null,
    row.status === "completed" ? null : row.status === "current" ? "In progress" : "Planned"
  ].filter(Boolean) as string[];

  function move(patch: Partial<CoursePlacement>) {
    const gradeLevel = patch.gradeLevel ?? row.grade_level;
    const term = patch.term ?? row.term;
    if (gradeLevel === 12 && term === "summer") return;
    const nextStatus = patch.status ?? (gradeLevel < currentGrade ? "completed" : gradeLevel === currentGrade ? "current" : "planned");
    onMove(row, {
      gradeLevel,
      term,
      status: nextStatus
    });
  }

  return (
    <div ref={setNodeRef} className={`kanban-course ${editing ? "editing" : ""} ${isDragging ? "dragging" : ""} ${locked ? "locked" : "draggable"} ${continuation ? "continuation" : ""} ${row.status === "completed" ? "completed" : ""} ${isSmccd ? `dual-enrollment institution-${institution?.toLowerCase()}` : ""}`}>
      <article
        className="kanban-course-main"
        {...(locked || editing || continuation ? {} : listeners)}
        {...(locked || editing || continuation ? {} : attributes)}
        aria-label={continuation ? `${title}, full-year course continuing in spring.` : locked || editing ? undefined : `Move ${title}. Drag this card to another school year or term.`}
      >
        {continuation
          ? <span className="kanban-continuation-mark" aria-hidden />
          : locked
          ? <span className="kanban-lock" title={row.status === "completed" ? "Completed courses cannot move" : "This course cannot move"}><LockKey size={16} /><span>Locked</span></span>
          : <span className="kanban-drag-affordance" title="Drag to another term"><DotsSixVertical size={18} /><span>Drag</span></span>}
        <div className="kanban-course-copy">
          {institution && <span className="kanban-course-institution"><InstitutionMark institution={institution} decorative /><span>{INSTITUTIONS[institution].name}<small>Dual enrollment</small></span></span>}
          <strong>{title}</strong>
          <div className="kanban-course-meta">{metadata.map((item) => <span key={item}>{item}</span>)}</div>
          {row.status === "completed" && <small>{row.letter_grade ? `Final grade ${row.letter_grade}` : "Final grade not entered"}</small>}
        </div>
      </article>
      {!continuation && <button className="icon-button course-edit-button" type="button" onClick={() => onEditingChange(editing ? null : row.id)} aria-expanded={editing} aria-label={`${editing ? "Close editor for" : "Edit"} ${title}`}><PencilSimple size={15} /></button>}
      {editing && <div className="kanban-course-editor">
        <label><span>Status</span>{locked
          ? <input value={row.status === "completed" ? "Completed" : "Locked"} readOnly />
          : <select value={row.status} onChange={(event) => move({ status: event.target.value as CourseStatus })}><option value="completed">Completed</option><option value="current">In progress</option><option value="planned">Planned</option></select>}</label>
        <label><span>Final grade</span><select value={row.letter_grade ?? ""} onChange={(event) => onUpdate(row.id, { letter_grade: event.target.value || null })}>{LETTER_GRADES.map((grade) => <option value={grade} key={grade}>{grade || "Not entered"}</option>)}</select></label>
        <label><span>Grade level</span>{locked
          ? <input value={`Grade ${row.grade_level}`} readOnly />
          : <select value={row.grade_level} onChange={(event) => move({ gradeLevel: Number(event.target.value) as GradeLevel })}>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade} disabled={grade < currentGrade || (grade === 12 && row.term === "summer")}>Grade {grade}</option>)}</select>}</label>
        <label><span>Term</span>{locked
          ? <input value={termLabel(row.term)} readOnly />
          : catalogCourse?.term_type === "year"
            ? <input value="Full year" readOnly />
            : <select value={row.term === "full_year" ? "fall" : row.term} onChange={(event) => move({ term: event.target.value as CourseBoardTerm })}>{courseBoardTermsForGrade(row.grade_level).map((term) => <option value={term} key={term}>{TERM_CONTENT[term].label}</option>)}</select>}</label>
        <label className="course-weight-control"><input type="checkbox" checked={weighted} disabled={isSmccd} onChange={(event) => onUpdate(row.id, { is_weighted: event.target.checked })} /><span>{isSmccd ? "College courses are weighted" : "Weighted or honors"}</span></label>
        <button className="danger-button small" type="button" onClick={() => onRemove(row.id)}><Trash size={15} /> Remove</button>
      </div>}
    </div>
  );
}

function TermLane({
  grade,
  term,
  rows,
  locked,
  children
}: {
  grade: GradeLevel;
  term: CourseBoardTerm;
  rows: PlanCourse[];
  locked: boolean;
  children: React.ReactNode;
}) {
  const id = `grade-${grade}-${term}`;
  const { setNodeRef, isOver } = useDroppable({ id, disabled: locked, data: { gradeLevel: grade, term } });
  const content = TERM_CONTENT[term];
  return <section ref={setNodeRef} className={`course-term-lane ${locked ? "locked" : ""} ${isOver ? "drop-target" : ""}`} aria-labelledby={`${id}-heading`}>
    <header><div><h3 id={`${id}-heading`}>{content.label}</h3><p>{content.description}</p></div><strong>{rows.length}</strong></header>
    <div className="course-term-lane-body">{rows.length ? children : <p className="course-term-empty">{locked ? "No recorded courses" : "No courses yet"}</p>}</div>
  </section>;
}

export default function CourseKanban(props: CourseKanbanProps) {
  const currentGrade = (props.settings.grade_level ?? 9) as GradeLevel;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel>(currentGrade);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const courseMap = useMemo(() => new Map(props.courses.map((course) => [course.id, course])), [props.courses]);
  const smccdCourseMap = useMemo(() => new Map(props.smccdCourses.map((course) => [course.id, course])), [props.smccdCourses]);
  const activeRow = useMemo(() => activeId ? props.rows.find((row) => row.id === activeId) ?? null : null, [activeId, props.rows]);
  const graduationYear = props.settings.graduation_year ?? new Date().getFullYear() + (12 - currentGrade);
  const selectedRows = useMemo(
    () => props.rows.filter((row) => row.grade_level === selectedGrade),
    [props.rows, selectedGrade]
  );
  const selectedYearLocked = selectedGrade < currentGrade;
  const selectedYearState = selectedYearLocked ? "completed" : selectedGrade === currentGrade ? "current" : "future";

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    props.onEditingChange(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const row = props.rows.find((candidate) => candidate.id === String(event.active.id));
    const destination = event.over?.data.current as { gradeLevel?: GradeLevel; term?: CourseBoardTerm } | undefined;
    setActiveId(null);
    if (!row || row.status === "completed" || row.source_review_item_id || !destination?.gradeLevel || !destination.term || destination.gradeLevel < currentGrade || (destination.gradeLevel === 12 && destination.term === "summer")) return;
    const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
    const term = catalogCourse?.term_type === "year" ? "full_year" : destination.term;
    const status: CourseStatus = destination.gradeLevel === currentGrade ? "current" : "planned";
    if (row.grade_level === destination.gradeLevel && row.term === term && row.status === status) return;
    props.onMove(row, { gradeLevel: destination.gradeLevel, term, status });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <div className="course-plan-toolbar"><p>Choose a grade, then drag unlocked courses between terms. Use Edit to move a course to another school year.</p><button className="secondary-button small" type="button" onClick={props.onGeneratePlan} disabled={props.busy}><ListPlus size={15} /> Suggest courses</button></div>
      <div className="course-grade-tabs" role="tablist" aria-label="High school year">
        {GRADE_LEVELS.map((grade) => {
          const courseCount = props.rows.filter((row) => row.grade_level === grade).length;
          const state = grade < currentGrade ? "completed" : grade === currentGrade ? "current" : "future";
          return <button
            id={`course-grade-${grade}`}
            className={state}
            type="button"
            role="tab"
            aria-selected={selectedGrade === grade}
            aria-controls={`course-year-${grade}`}
            onClick={() => {
              setSelectedGrade(grade);
              props.onEditingChange(null);
            }}
            key={grade}
          >
            <span>Grade {grade}</span>
            <small>{schoolYearForGrade(graduationYear, grade)} · {courseCount} {courseCount === 1 ? "course" : "courses"}</small>
          </button>;
        })}
      </div>
      <section className="course-year-board" aria-label="Four-year course plan">
        <section className={`course-year ${selectedYearState}`} id={`course-year-${selectedGrade}`} role="tabpanel" aria-labelledby={`course-grade-${selectedGrade}`}>
          <div className={`course-year-terms ${selectedGrade === 12 ? "two-terms" : ""}`}>{courseBoardTermsForGrade(selectedGrade).map((term) => {
            const termRows = selectedRows.filter((row) => courseAppearsInBoardTerm(row, term)).sort(compareCourseBoardRows);
            return <TermLane grade={selectedGrade} term={term} rows={termRows} locked={selectedYearLocked} key={term}>
              {termRows.map((row) => <CourseCard row={row} courseMap={courseMap} smccdCourseMap={smccdCourseMap} settings={props.settings} sectionLocked={selectedYearLocked} continuation={row.term === "full_year" && term === "spring"} editing={props.editingCourseId === row.id} busy={props.busy} onEditingChange={props.onEditingChange} onMove={props.onMove} onUpdate={props.onUpdate} onRemove={props.onRemove} key={`${row.id}-${term}`} />)}
            </TermLane>;
          })}</div>
        </section>
      </section>
      <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {activeRow && <div className="course-drag-preview"><HandGrabbing size={19} weight="bold" /><span><strong>{courseDisplayName(activeRow, courseMap)}</strong><small>Release over a year and term</small></span></div>}
      </DragOverlay>
    </DndContext>
  );
}
