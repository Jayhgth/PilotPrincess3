import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import {
  DotsSixVerticalIcon as DotsSixVertical,
  HandGrabbingIcon as HandGrabbing,
  ListPlusIcon as ListPlus,
  LockKeyIcon as LockKey,
  SortAscendingIcon as SortAscending,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import {
  boardTermForYearDrop,
  compareCourseBoardRows,
  compareCourseBoardRowsForTerm,
  courseStatusForBoardMove,
  courseAppearsInBoardTerm,
  courseBoardTermsForGrade,
  orderedCourseIdsForBoardMove,
  isCollegePlanCourse,
  isPassFailPlanCourse,
  type CourseBoardTerm
} from "@/lib/course-board";
import { INSTITUTIONS } from "@/lib/institutions";
import { courseDisplayName, GRADE_LEVELS, REQUIREMENT_LABELS, schoolYearForGrade } from "@/lib/planning";
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
  orderedCourseIds: string[];
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
  busy: boolean;
  onMove: (row: PlanCourse, placement: CoursePlacement) => boolean;
  onRemove: (id: string) => void;
  onSort: () => void;
  onGeneratePlan: () => void;
}

interface CourseCardProps {
  row: PlanCourse;
  courseMap: Map<string, Course>;
  smccdCourseMap: Map<string, SmccdCourse>;
  sectionLocked: boolean;
  continuation?: boolean;
  confirmingRemove: boolean;
  busy: boolean;
  onRemoveRequest: (id: string) => void;
  boardTerm: CourseBoardTerm;
}

type SortableBindings = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setNodeRef" | "setActivatorNodeRef" | "isDragging" | "isOver" | "transform" | "transition"
>;

function CourseCard(props: CourseCardProps) {
  if (props.continuation) return <CourseCardBody {...props} locked continuation />;
  const locked = props.sectionLocked || props.row.status === "completed" || Boolean(props.row.source_review_item_id);
  return <SortableCourseCard {...props} locked={locked} />;
}

function SortableCourseCard(props: CourseCardProps & { locked: boolean }) {
  const sortable = useSortable({
    id: props.row.id,
    disabled: {
      draggable: props.locked || props.busy || props.confirmingRemove,
      droppable: props.busy
    },
    data: {
      type: "course",
      row: props.row,
      gradeLevel: props.row.grade_level,
      term: props.boardTerm
    },
    transition: { duration: 135, easing: "cubic-bezier(.2,.8,.2,1)" }
  });
  return <CourseCardBody {...props} drag={sortable} />;
}

function CourseCardBody({
  row,
  courseMap,
  smccdCourseMap,
  confirmingRemove,
  busy,
  onRemoveRequest,
  locked,
  continuation = false,
  drag
}: CourseCardProps & { locked: boolean; drag?: SortableBindings }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    isDragging = false,
    isOver = false,
    transform,
    transition
  } = drag ?? {};
  const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
  const isSmccd = isCollegePlanCourse(row);
  const smccdCourse = row.smccd_course_id ? smccdCourseMap.get(row.smccd_course_id) : null;
  const institution = smccdCourse?.college_code ?? (isSmccd ? "smccd" : null);
  const weighted = isSmccd || row.is_weighted;
  const isPassFail = isPassFailPlanCourse(row);
  const title = courseDisplayName(row, courseMap);
  const metadata = [
    termLabel(row.term),
    row.credits ? formatCredits(Number(row.credits)) : "Credits need review",
    isSmccd ? null : catalogCourse?.subject ?? (row.requirement_area_override ? REQUIREMENT_LABELS[row.requirement_area_override] : "Custom"),
    weighted ? "Weighted" : null,
    isPassFail ? "Pass/fail, outside GPA" : null,
    row.status === "completed" ? null : row.status === "current" ? "In progress" : "Planned"
  ].filter(Boolean) as string[];
  const style: CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition: isDragging ? undefined : transition
      }
    : transition
      ? { transition }
      : undefined;

  return (
    <div ref={setNodeRef} style={style} className={`kanban-course ${confirmingRemove ? "confirming-remove" : ""} ${isDragging ? "dragging" : ""} ${isOver && !isDragging ? "sorting-over" : ""} ${locked ? "locked" : "draggable"} ${continuation ? "continuation" : ""} ${row.status === "completed" ? "completed" : ""} ${isSmccd ? `dual-enrollment institution-${institution?.toLowerCase()}` : ""}`}>
      <article
        ref={!locked && !confirmingRemove ? setActivatorNodeRef : undefined}
        className="kanban-course-main"
        {...(!locked && !confirmingRemove ? attributes : {})}
        {...(!locked && !confirmingRemove ? listeners : {})}
        aria-label={continuation ? `${title}, full-year course continuing in spring.` : locked || confirmingRemove ? undefined : `Move ${title}. Drag this card to another school year or term.`}
        aria-describedby={!locked && !confirmingRemove ? "course-plan-drag-guide" : undefined}
      >
        {continuation
          ? <span className="kanban-continuation-mark" aria-hidden />
          : locked
          ? <span className="kanban-lock" title={row.status === "completed" ? "Completed courses cannot move" : "This course cannot move"}><LockKey size={16} /><span>Locked</span></span>
          : <span className="kanban-drag-indicator" aria-hidden><DotsSixVertical size={18} weight="bold" /></span>}
        <div className="kanban-course-copy">
          {institution && <span className="kanban-course-institution"><InstitutionMark institution={institution} decorative /><span>{INSTITUTIONS[institution].name}<small>Dual enrollment</small></span></span>}
          <strong>{title}</strong>
          <div className="kanban-course-meta">{metadata.map((item) => <span key={item}>{item}</span>)}</div>
          {row.status === "completed" && <small>{row.letter_grade ? `Final grade ${row.letter_grade}` : "Final grade not entered"}</small>}
        </div>
      </article>
      {!continuation && <button
        className={`icon-button course-delete-button ${confirmingRemove ? "confirm" : ""}`}
        type="button"
        onClick={() => onRemoveRequest(row.id)}
        disabled={busy || Boolean(row.source_review_item_id)}
        title={row.source_review_item_id ? "Correct transcript-backed courses through transcript review" : confirmingRemove ? "Click again to remove" : "Remove course"}
        aria-label={row.source_review_item_id ? `${title} is transcript-backed and cannot be removed here` : confirmingRemove ? `Confirm removal of ${title}` : `Remove ${title}`}
      ><Trash size={15} />{confirmingRemove && <span>Confirm</span>}</button>}
    </div>
  );
}

function GradeTab({
  grade,
  currentGrade,
  selected,
  activeRow,
  schoolYear,
  courseCount,
  onSelect
}: {
  grade: GradeLevel;
  currentGrade: GradeLevel;
  selected: boolean;
  activeRow: PlanCourse | null;
  schoolYear: string;
  courseCount: number;
  onSelect: () => void;
}) {
  const state = grade < currentGrade ? "past" : grade === currentGrade ? "current" : "future";
  const acceptsActive = Boolean(activeRow);
  const { setNodeRef, isOver } = useDroppable({
    id: `grade-${grade}`,
    data: { type: "year", gradeLevel: grade }
  });
  return <button
    ref={setNodeRef}
    id={`course-grade-${grade}`}
    className={`${state} ${activeRow && acceptsActive ? "drag-available" : ""} ${isOver ? "drop-target" : ""}`}
    type="button"
    role="tab"
    aria-selected={selected}
    aria-controls={`course-year-${grade}`}
    onClick={onSelect}
  >
    <span>Grade {grade}</span>
    <small>{isOver && activeRow
      ? `Move here, keep ${termLabel(activeRow.term).toLowerCase()}`
      : `${schoolYear} · ${courseCount} ${courseCount === 1 ? "course" : "courses"}`}</small>
  </button>;
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
  const { setNodeRef, isOver } = useDroppable({ id, disabled: locked, data: { type: "lane", gradeLevel: grade, term } });
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
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!confirmingRemoveId) return;
    const timeout = window.setTimeout(() => setConfirmingRemoveId(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [confirmingRemoveId]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 7 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const courseMap = useMemo(() => new Map(props.courses.map((course) => [course.id, course])), [props.courses]);
  const smccdCourseMap = useMemo(() => new Map(props.smccdCourses.map((course) => [course.id, course])), [props.smccdCourses]);
  const activeRow = useMemo(() => activeId ? props.rows.find((row) => row.id === activeId) ?? null : null, [activeId, props.rows]);
  const graduationYear = props.settings.graduation_year ?? new Date().getFullYear() + (12 - currentGrade);
  const selectedRows = useMemo(
    () => props.rows.filter((row) => row.grade_level === selectedGrade),
    [props.rows, selectedGrade]
  );
  const selectedYearState = selectedGrade < currentGrade ? "past" : selectedGrade === currentGrade ? "current" : "future";
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return [...pointerCollisions].sort((left, right) => {
        const typeRank = (id: typeof left.id) => {
          const type = args.droppableContainers.find((container) => container.id === id)?.data.current?.type;
          return type === "course" ? 0 : type === "lane" ? 1 : 2;
        };
        return typeRank(left.id) - typeRank(right.id);
      });
    }
    const intersections = rectIntersection(args);
    return intersections.length > 0 ? intersections : closestCenter(args);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
    setConfirmingRemoveId(null);
  }

  function handleDragCancel() {
    const row = props.rows.find((candidate) => candidate.id === activeId);
    setActiveId(null);
    if (row) setSelectedGrade(row.grade_level);
  }

  function handleRemoveRequest(id: string) {
    if (confirmingRemoveId !== id) {
      setConfirmingRemoveId(id);
      return;
    }
    setConfirmingRemoveId(null);
    props.onRemove(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    const row = props.rows.find((candidate) => candidate.id === String(event.active.id));
    const destination = event.over?.data.current as { type?: "course" | "lane" | "year"; gradeLevel?: GradeLevel; term?: CourseBoardTerm } | undefined;
    setActiveId(null);
    if (!row) return;
    if (row.status === "completed" || row.source_review_item_id || !destination?.gradeLevel) {
      setSelectedGrade(row.grade_level);
      return;
    }
    const destinationBoardTerm = destination.type === "year"
      ? boardTermForYearDrop(row.term, destination.gradeLevel)
      : destination.term;
    if (!destinationBoardTerm) {
      setSelectedGrade(row.grade_level);
      return;
    }
    const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
    const term = catalogCourse?.term_type === "year" || row.term === "full_year" ? "full_year" : destinationBoardTerm;
    const status = courseStatusForBoardMove(currentGrade, destination.gradeLevel, row.status);
    const destinationRows = props.rows
      .filter((candidate) => candidate.grade_level === destination.gradeLevel)
      .sort(compareCourseBoardRows);
    const destinationIds = destinationRows.map((candidate) => candidate.id);
    const overId = destination.type === "course" ? String(event.over?.id) : null;
    const activeRect = event.active.rect.current.translated;
    const overRect = event.over?.rect;
    const insertAfter = Boolean(activeRect && overRect && activeRect.top > overRect.top + overRect.height / 2);
    const orderedCourseIds = orderedCourseIdsForBoardMove(
      props.rows,
      row.id,
      destination.gradeLevel,
      destinationBoardTerm,
      overId,
      insertAfter
    );
    const orderChanged = orderedCourseIds.length !== destinationIds.length
      || orderedCourseIds.some((id, index) => destinationIds[index] !== id);
    if (row.grade_level === destination.gradeLevel && row.term === term && row.status === status && !orderChanged) return;
    const moved = props.onMove(row, { gradeLevel: destination.gradeLevel, term, status, orderedCourseIds });
    setSelectedGrade(moved ? destination.gradeLevel : row.grade_level);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      autoScroll={{ acceleration: 8, interval: 12, threshold: { x: 0.16, y: 0.18 } }}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className="course-plan-toolbar">
        <p className={`course-plan-drag-guide ${activeRow ? "active" : ""}`} id="course-plan-drag-guide"><DotsSixVertical size={16} weight="bold" /><span>{activeRow ? "Drop on a grade tab to move years, or on a term column to place it precisely." : "Drag from any open area of an editable card. Completed and transcript-backed courses stay locked."}</span></p>
        <div className="course-plan-toolbar-actions">
          <button className="secondary-button small" type="button" onClick={props.onSort} disabled={props.busy || props.rows.length < 2} title="Sort every grade with college courses first and pass/fail courses last"><SortAscending size={15} /> Sort courses</button>
          <button className="secondary-button small" type="button" onClick={props.onGeneratePlan} disabled={props.busy}><ListPlus size={15} /> Suggest courses</button>
        </div>
      </div>
      <div className={`course-grade-tabs ${activeRow ? "dragging-course" : ""}`} role="tablist" aria-label="High school year">
        {GRADE_LEVELS.map((grade) => {
          const courseCount = props.rows.filter((row) => row.grade_level === grade).length;
          return <GradeTab
            grade={grade}
            currentGrade={currentGrade}
            selected={selectedGrade === grade}
            activeRow={activeRow}
            schoolYear={schoolYearForGrade(graduationYear, grade)}
            courseCount={courseCount}
            onSelect={() => {
              setSelectedGrade(grade);
              setConfirmingRemoveId(null);
            }}
            key={grade}
          />;
        })}
      </div>
      <section className="course-year-board" aria-label="Four-year course plan">
        <section className={`course-year ${selectedYearState}`} id={`course-year-${selectedGrade}`} role="tabpanel" aria-labelledby={`course-grade-${selectedGrade}`}>
          <div className={`course-year-terms ${selectedGrade === 12 ? "two-terms" : ""}`}>{courseBoardTermsForGrade(selectedGrade).map((term) => {
            const termRows = selectedRows.filter((row) => courseAppearsInBoardTerm(row, term)).sort(compareCourseBoardRowsForTerm(term));
            const sortableTermRows = termRows.filter((row) => !(row.term === "full_year" && term === "spring"));
            return <TermLane grade={selectedGrade} term={term} rows={termRows} locked={false} key={term}>
              <SortableContext items={sortableTermRows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
                {termRows.map((row) => <CourseCard row={row} boardTerm={term} courseMap={courseMap} smccdCourseMap={smccdCourseMap} sectionLocked={false} continuation={row.term === "full_year" && term === "spring"} confirmingRemove={confirmingRemoveId === row.id} busy={props.busy} onRemoveRequest={handleRemoveRequest} key={`${row.id}-${term}`} />)}
              </SortableContext>
            </TermLane>;
          })}</div>
        </section>
      </section>
      <DragOverlay dropAnimation={reduceMotion ? null : { duration: 135, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {activeRow && <div className="course-drag-preview"><HandGrabbing size={18} weight="bold" /><span><strong>{courseDisplayName(activeRow, courseMap)}</strong><small>Choose a year, then place it in a term</small></span></div>}
      </DragOverlay>
    </DndContext>
  );
}
