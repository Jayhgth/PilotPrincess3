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
import { INSTITUTIONS } from "@/lib/institutions";
import { courseDisplayName, GRADE_LEVELS, LETTER_GRADES, REQUIREMENT_LABELS, schoolYearForGrade } from "@/lib/planning";
import type { Course, CourseStatus, GradeLevel, PlanCourse, SmccdCourse, StudentSettings } from "@/lib/models";

const BOARD_TERMS = ["fall", "spring", "summer"] as const;
type BoardTerm = typeof BOARD_TERMS[number];

const TERM_CONTENT: Record<BoardTerm, { label: string; description: string }> = {
  fall: { label: "Fall", description: "Full-year classes begin here" },
  spring: { label: "Spring", description: "Second semester" },
  summer: { label: "Summer", description: "Summer term" }
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

function boardTerm(row: PlanCourse): BoardTerm {
  return row.term === "full_year" ? "fall" : row.term;
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
  editing: boolean;
  busy: boolean;
  onEditingChange: (id: string | null) => void;
  onMove: (row: PlanCourse, placement: CoursePlacement) => void;
  onUpdate: (id: string, patch: Partial<PlanCourse>) => void;
  onRemove: (id: string) => void;
}

type DragBindings = Pick<ReturnType<typeof useDraggable>, "attributes" | "listeners" | "setNodeRef" | "isDragging">;

function CourseCard(props: CourseCardProps) {
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
  drag
}: CourseCardProps & { locked: boolean; drag?: DragBindings }) {
  const { attributes, listeners, setNodeRef, isDragging = false } = drag ?? {};
  const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
  const isSmccd = Boolean(row.smccd_course_id || Number(row.college_units ?? 0) > 0);
  const smccdCourse = row.smccd_course_id ? smccdCourseMap.get(row.smccd_course_id) : null;
  const institution = smccdCourse?.college_code ?? (isSmccd ? "smccd" : null);
  const weighted = isSmccd || row.is_weighted;
  const isPass = row.letter_grade?.toUpperCase() === "P";
  const title = courseDisplayName(row, courseMap);
  const currentGrade = (settings.grade_level ?? 9) as GradeLevel;
  const metadata = [
    termLabel(row.term),
    row.credits ? formatCredits(Number(row.credits)) : "Credits need review",
    isSmccd ? null : catalogCourse?.subject ?? (row.requirement_area_override ? REQUIREMENT_LABELS[row.requirement_area_override] : "Custom"),
    weighted ? "Weighted" : null,
    isPass ? "Pass, outside GPA" : null,
    row.status === "completed" ? null : row.status === "current" ? "In progress" : "Planned"
  ].filter(Boolean) as string[];

  function move(patch: Partial<CoursePlacement>) {
    const gradeLevel = patch.gradeLevel ?? row.grade_level;
    const nextStatus = patch.status ?? (gradeLevel < currentGrade ? "completed" : gradeLevel === currentGrade ? "current" : "planned");
    onMove(row, {
      gradeLevel,
      term: patch.term ?? row.term,
      status: nextStatus
    });
  }

  return (
    <div ref={setNodeRef} className={`kanban-course ${editing ? "editing" : ""} ${isDragging ? "dragging" : ""} ${locked ? "locked" : "draggable"} ${row.status === "completed" ? "completed" : ""} ${isSmccd ? `dual-enrollment institution-${institution?.toLowerCase()}` : ""}`}>
      <article
        className="kanban-course-main"
        {...(locked || editing ? {} : listeners)}
        {...(locked || editing ? {} : attributes)}
        aria-label={locked || editing ? undefined : `Move ${title}. Drag this card to another school year or term.`}
      >
        {locked
          ? <span className="kanban-lock" title={row.status === "completed" ? "Completed courses cannot move" : "This course cannot move"}><LockKey size={16} /><span>Locked</span></span>
          : <span className="kanban-drag-affordance" title="Drag to another term"><DotsSixVertical size={18} /><span>Drag</span></span>}
        <div className="kanban-course-copy">
          {institution && <span className="kanban-course-institution"><InstitutionMark institution={institution} decorative /><span>{INSTITUTIONS[institution].name}<small>Dual enrollment</small></span></span>}
          <strong>{title}</strong>
          <div className="kanban-course-meta">{metadata.map((item) => <span key={item}>{item}</span>)}</div>
          {row.status === "completed" && <small>{row.letter_grade ? `Final grade ${row.letter_grade}` : "Final grade not entered"}</small>}
        </div>
      </article>
      <button className="icon-button course-edit-button" type="button" onClick={() => onEditingChange(editing ? null : row.id)} aria-expanded={editing} aria-label={`${editing ? "Close editor for" : "Edit"} ${title}`}><PencilSimple size={15} /></button>
      {editing && <div className="kanban-course-editor">
        <label><span>Status</span>{locked
          ? <input value={row.status === "completed" ? "Completed" : "Locked"} readOnly />
          : <select value={row.status} onChange={(event) => move({ status: event.target.value as CourseStatus })}><option value="completed">Completed</option><option value="current">In progress</option><option value="planned">Planned</option></select>}</label>
        <label><span>Final grade</span><select value={row.letter_grade ?? ""} onChange={(event) => onUpdate(row.id, { letter_grade: event.target.value || null })}>{LETTER_GRADES.map((grade) => <option value={grade} key={grade}>{grade || "Not entered"}</option>)}</select></label>
        <label><span>Grade level</span>{locked
          ? <input value={`Grade ${row.grade_level}`} readOnly />
          : <select value={row.grade_level} onChange={(event) => move({ gradeLevel: Number(event.target.value) as GradeLevel })}>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade} disabled={grade < currentGrade}>Grade {grade}</option>)}</select>}</label>
        <label><span>Term</span>{locked
          ? <input value={termLabel(row.term)} readOnly />
          : catalogCourse?.term_type === "year"
            ? <input value="Full year" readOnly />
            : <select value={row.term === "full_year" ? "fall" : row.term} onChange={(event) => move({ term: event.target.value as BoardTerm })}>{BOARD_TERMS.map((term) => <option value={term} key={term}>{TERM_CONTENT[term].label}</option>)}</select>}</label>
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
  term: BoardTerm;
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const courseMap = useMemo(() => new Map(props.courses.map((course) => [course.id, course])), [props.courses]);
  const smccdCourseMap = useMemo(() => new Map(props.smccdCourses.map((course) => [course.id, course])), [props.smccdCourses]);
  const activeRow = useMemo(() => activeId ? props.rows.find((row) => row.id === activeId) ?? null : null, [activeId, props.rows]);
  const currentGrade = (props.settings.grade_level ?? 9) as GradeLevel;
  const graduationYear = props.settings.graduation_year ?? new Date().getFullYear() + (12 - currentGrade);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    props.onEditingChange(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const row = props.rows.find((candidate) => candidate.id === String(event.active.id));
    const destination = event.over?.data.current as { gradeLevel?: GradeLevel; term?: BoardTerm } | undefined;
    setActiveId(null);
    if (!row || row.status === "completed" || row.source_review_item_id || !destination?.gradeLevel || !destination.term || destination.gradeLevel < currentGrade) return;
    const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
    const term = catalogCourse?.term_type === "year" ? "full_year" : destination.term;
    const status: CourseStatus = destination.gradeLevel === currentGrade ? "current" : "planned";
    if (row.grade_level === destination.gradeLevel && row.term === term && row.status === status) return;
    props.onMove(row, { gradeLevel: destination.gradeLevel, term, status });
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <div className="course-plan-toolbar"><p>Drag unlocked courses between open years and terms. Completed years and courses stay visible but locked.</p><button className="secondary-button small" type="button" onClick={props.onGeneratePlan} disabled={props.busy}><ListPlus size={15} /> Suggest courses</button></div>
      <section className="course-year-board" aria-label="Four-year course plan">
        {GRADE_LEVELS.map((grade) => {
          const rows = props.rows.filter((row) => row.grade_level === grade).sort((left, right) => left.sort_order - right.sort_order);
          const locked = grade < currentGrade;
          const state = locked ? "completed" : grade === currentGrade ? "current" : "future";
          return <section className={`course-year ${state}`} aria-labelledby={`course-year-${grade}`} key={grade}>
            <header className="course-year-header"><div><h2 id={`course-year-${grade}`}>Grade {grade}</h2><p>{schoolYearForGrade(graduationYear, grade)}</p></div><strong>{rows.length} {rows.length === 1 ? "course" : "courses"}</strong></header>
            <div className="course-year-terms">{BOARD_TERMS.map((term) => {
              const termRows = rows.filter((row) => boardTerm(row) === term);
              return <TermLane grade={grade} term={term} rows={termRows} locked={locked} key={term}>
                {termRows.map((row) => <CourseCard row={row} courseMap={courseMap} smccdCourseMap={smccdCourseMap} settings={props.settings} sectionLocked={locked} editing={props.editingCourseId === row.id} busy={props.busy} onEditingChange={props.onEditingChange} onMove={props.onMove} onUpdate={props.onUpdate} onRemove={props.onRemove} key={row.id} />)}
              </TermLane>;
            })}</div>
          </section>;
        })}
      </section>
      <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {activeRow && <div className="course-drag-preview"><HandGrabbing size={19} weight="bold" /><span><strong>{courseDisplayName(activeRow, courseMap)}</strong><small>Release over a year and term</small></span></div>}
      </DragOverlay>
    </DndContext>
  );
}
