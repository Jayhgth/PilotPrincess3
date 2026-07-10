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
  CheckCircleIcon as CheckCircle,
  DotsSixVerticalIcon as DotsSixVertical,
  GaugeIcon as Gauge,
  ListChecksIcon as ListChecks,
  LockKeyIcon as LockKey,
  PencilSimpleIcon as PencilSimple,
  SparkleIcon as Sparkle,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { courseDisplayName, GRADE_LEVELS, LETTER_GRADES, schoolYearForGrade } from "@/lib/planning";
import type { Course, CourseStatus, GradeLevel, PlanCourse, StudentProfile } from "@/lib/models";

const STATUS_ORDER: CourseStatus[] = ["completed", "current", "planned"];
const STATUS_CONTENT = {
  completed: { label: "Done", description: "Finished and transcript-backed", icon: CheckCircle },
  current: { label: "In progress", description: "What you are taking now", icon: Gauge },
  planned: { label: "Planned", description: "Courses you can still change", icon: ListChecks }
} as const;

function formatCredits(value: number) {
  return `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)} cr`;
}

interface CourseKanbanProps {
  rows: PlanCourse[];
  courses: Course[];
  profile: StudentProfile;
  editingCourseId: string | null;
  busy: boolean;
  onEditingChange: (id: string | null) => void;
  onMove: (row: PlanCourse, status: CourseStatus) => void;
  onUpdate: (id: string, patch: Partial<PlanCourse>) => void;
  onRemove: (id: string) => void;
  onGeneratePlan: () => void;
  onImportTranscript: () => void;
  onBrowseCourses: () => void;
}

function CourseCard({
  row,
  courseMap,
  profile,
  editing,
  busy,
  onEditingChange,
  onMove,
  onUpdate,
  onRemove
}: {
  row: PlanCourse;
  courseMap: Map<string, Course>;
  profile: StudentProfile;
  editing: boolean;
  busy: boolean;
  onEditingChange: (id: string | null) => void;
  onMove: (row: PlanCourse, status: CourseStatus) => void;
  onUpdate: (id: string, patch: Partial<PlanCourse>) => void;
  onRemove: (id: string) => void;
}) {
  const locked = Boolean(row.source_review_item_id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
    disabled: locked || busy,
    data: { row }
  });
  const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
  const isSmccd = Boolean(row.smccd_course_id || Number(row.college_units ?? 0) > 0);
  const weighted = isSmccd || row.is_weighted;
  const isPass = row.letter_grade?.toUpperCase() === "P";
  const title = courseDisplayName(row, courseMap);
  const style: CSSProperties | undefined = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const metadata = [
    `Grade ${row.grade_level}`,
    row.credits ? formatCredits(Number(row.credits)) : "Credits need review",
    isSmccd ? "SMCCD" : catalogCourse?.subject ?? row.requirement_area_override?.replaceAll("_", " ") ?? "Custom",
    weighted ? "Weighted" : null,
    isPass ? "Pass, outside GPA" : null
  ].filter(Boolean) as string[];

  return (
    <article ref={setNodeRef} style={style} className={`kanban-course ${editing ? "editing" : ""} ${isDragging ? "dragging" : ""} ${locked ? "locked" : ""}`}>
      <div className="kanban-course-main">
        {locked
          ? <span className="kanban-lock" title="Transcript records cannot move"><LockKey size={15} /><span>Transcript</span></span>
          : <button className="course-drag-handle" type="button" aria-label={`Move ${title}`} {...listeners} {...attributes}><DotsSixVertical size={18} /></button>}
        <div className="kanban-course-copy">
          <strong>{title}</strong>
          <span>{metadata.map((item) => <span key={item}>{item}</span>)}</span>
          {row.status === "completed" && <small>{row.letter_grade ? `Final grade ${row.letter_grade}` : "Final grade not entered"}</small>}
        </div>
        <button className="icon-button course-edit-button" type="button" onClick={() => onEditingChange(editing ? null : row.id)} aria-expanded={editing} aria-label={`${editing ? "Close editor for" : "Edit"} ${title}`}><PencilSimple size={15} /></button>
      </div>
      {editing && <div className="kanban-course-editor">
        <label><span>Status</span>{locked
          ? <input value="Done from transcript" readOnly />
          : <select value={row.status} onChange={(event) => onMove(row, event.target.value as CourseStatus)}><option value="completed">Done</option><option value="current">In progress</option><option value="planned">Planned</option></select>}</label>
        <label><span>Final grade</span><select value={row.letter_grade ?? ""} onChange={(event) => onUpdate(row.id, { letter_grade: event.target.value || null })}>{LETTER_GRADES.map((grade) => <option value={grade} key={grade}>{grade || "Not entered"}</option>)}</select></label>
        <label><span>Grade level</span>{locked
          ? <input value={`Grade ${row.grade_level}`} readOnly />
          : <select value={row.grade_level} onChange={(event) => { const grade = Number(event.target.value) as GradeLevel; onUpdate(row.id, { grade_level: grade, school_year: schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, grade) }); }}>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select>}</label>
        <label className="course-weight-control"><input type="checkbox" checked={weighted} disabled={isSmccd} onChange={(event) => onUpdate(row.id, { is_weighted: event.target.checked })} /><span>{isSmccd ? "SMCCD courses are weighted" : "Weighted or honors"}</span></label>
        <button className="danger-button small" type="button" onClick={() => onRemove(row.id)}><Trash size={15} /> Remove</button>
      </div>}
    </article>
  );
}

function KanbanColumn({
  status,
  rows,
  children,
  onGeneratePlan,
  busy,
  onImportTranscript,
  onBrowseCourses
}: {
  status: CourseStatus;
  rows: PlanCourse[];
  children: ReactNode;
  onGeneratePlan: () => void;
  busy: boolean;
  onImportTranscript: () => void;
  onBrowseCourses: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const content = STATUS_CONTENT[status];
  const Icon = content.icon;
  return (
    <section ref={setNodeRef} className={`kanban-column ${status} ${isOver ? "drop-target" : ""}`} aria-labelledby={`kanban-${status}`}>
      <header className="kanban-column-header">
        <div><Icon size={18} /><span><h2 id={`kanban-${status}`}>{content.label}</h2><p>{content.description}</p></span></div>
        <strong>{rows.length}</strong>
      </header>
      <div className="kanban-column-body">
        {rows.length ? children : <div className="kanban-empty"><strong>No courses</strong><p>{status === "completed" ? "Import a transcript to add finished work." : status === "current" ? "Drop a course here when it starts." : "Add courses from either catalog."}</p><button className="quiet-button small" type="button" onClick={status === "completed" ? onImportTranscript : onBrowseCourses}>{status === "completed" ? "Import transcript" : "Find courses"}</button></div>}
      </div>
      {status === "planned" && <button className="kanban-column-action" type="button" onClick={onGeneratePlan} disabled={busy}><Sparkle size={14} /> Suggest courses</button>}
    </section>
  );
}

export default function CourseKanban(props: CourseKanbanProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor)
  );
  const courseMap = new Map(props.courses.map((course) => [course.id, course]));
  const activeRow = activeId ? props.rows.find((row) => row.id === activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    props.onEditingChange(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const row = props.rows.find((candidate) => candidate.id === String(event.active.id));
    const status = event.over?.id as CourseStatus | undefined;
    setActiveId(null);
    if (!row || !status || !STATUS_ORDER.includes(status) || row.status === status || row.source_review_item_id) return;
    props.onMove(row, status);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragCancel={() => setActiveId(null)} onDragEnd={handleDragEnd}>
      <p className="kanban-help">Drag courses between columns. Transcript records are locked to Done.</p>
      <div className="course-kanban-viewport">
        <section className="course-kanban" aria-label="Course kanban board">
          {STATUS_ORDER.map((status) => {
            const rows = props.rows
              .filter((row) => row.status === status)
              .sort((a, b) => status === "completed" ? b.grade_level - a.grade_level : a.grade_level - b.grade_level || a.sort_order - b.sort_order);
            return <KanbanColumn status={status} rows={rows} busy={props.busy} onGeneratePlan={props.onGeneratePlan} onImportTranscript={props.onImportTranscript} onBrowseCourses={props.onBrowseCourses} key={status}>
              {rows.map((row) => <CourseCard row={row} courseMap={courseMap} profile={props.profile} editing={props.editingCourseId === row.id} busy={props.busy} onEditingChange={props.onEditingChange} onMove={props.onMove} onUpdate={props.onUpdate} onRemove={props.onRemove} key={row.id} />)}
            </KanbanColumn>;
          })}
        </section>
      </div>
      <DragOverlay>{activeRow && <div className="course-drag-preview"><DotsSixVertical size={18} /><span><strong>{courseDisplayName(activeRow, courseMap)}</strong><small>Move to another column</small></span></div>}</DragOverlay>
    </DndContext>
  );
}
