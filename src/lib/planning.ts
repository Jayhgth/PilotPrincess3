import type {
  Activity,
  Course,
  CourseRequirementMapping,
  GpaSummary,
  GraduationRequirement,
  GradeLevel,
  PlanCourse,
  RequirementProgress,
  SimulationConfig,
  SimulationResult,
  StudentProfile,
  WorkloadSummary
} from "@/lib/models";

const GRADE_POINTS: Record<string, number> = {
  "A+": 4,
  A: 4,
  "A-": 3.7,
  "B+": 3.3,
  B: 3,
  "B-": 2.7,
  "C+": 2.3,
  C: 2,
  "C-": 1.7,
  "D+": 1.3,
  D: 1,
  "D-": 0.7,
  F: 0
};

export const REQUIREMENT_LABELS = {
  english: "English",
  social_science: "Social Science",
  math: "Mathematics",
  lab_science: "Laboratory Science",
  world_language: "World Language",
  design_lab: "Design Lab",
  visual_performing_arts: "Visual and Performing Arts",
  personal_development: "Personal Development"
} as const;

export const GRADE_LEVELS: GradeLevel[] = [9, 10, 11, 12];
export const LETTER_GRADES = ["", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "IP"];

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function schoolYearForGrade(graduationYear: number, grade: GradeLevel) {
  const endYear = graduationYear - (12 - grade);
  return `${endYear - 1}-${endYear}`;
}

export function courseDisplayName(planCourse: PlanCourse, courseMap: Map<string, Course>) {
  return planCourse.course_id ? courseMap.get(planCourse.course_id)?.name ?? "Unavailable course" : planCourse.custom_course_name ?? "Custom course";
}

export function calculateRequirementProgress(
  requirements: GraduationRequirement[],
  planCourses: PlanCourse[],
  mappings: CourseRequirementMapping[]
): RequirementProgress[] {
  const mappingsByCourse = new Map<string, CourseRequirementMapping[]>();
  for (const mapping of mappings) {
    const existing = mappingsByCourse.get(mapping.course_id) ?? [];
    existing.push(mapping);
    mappingsByCourse.set(mapping.course_id, existing);
  }

  return requirements.map((requirement) => {
    let completedCredits = 0;
    let currentCredits = 0;
    let plannedCredits = 0;
    let unverifiedCredits = 0;

    for (const planCourse of planCourses) {
      if (!planCourse.course_id) continue;
      const mapping = (mappingsByCourse.get(planCourse.course_id) ?? []).find(
        (candidate) => candidate.requirement_id === requirement.id
      );
      if (!mapping) continue;

      const credits = Number(planCourse.credits ?? 0);
      if (mapping.confidence === "uncertain" || !planCourse.mapping_verified) {
        unverifiedCredits += credits;
        continue;
      }
      if (planCourse.status === "completed") completedCredits += credits;
      if (planCourse.status === "current") currentCredits += credits;
      if (planCourse.status === "planned") plannedCredits += credits;
    }

    const verifiedProjectedCredits = completedCredits + currentCredits + plannedCredits;
    const percent = clamp(Math.round((verifiedProjectedCredits / requirement.credits_required) * 100), 0, 100);
    const status =
      completedCredits >= requirement.credits_required
        ? "complete"
        : verifiedProjectedCredits >= requirement.credits_required
          ? "on_track"
          : "missing";

    return {
      requirement,
      completedCredits: round(completedCredits, 1),
      currentCredits: round(currentCredits, 1),
      plannedCredits: round(plannedCredits, 1),
      verifiedProjectedCredits: round(verifiedProjectedCredits, 1),
      unverifiedCredits: round(unverifiedCredits, 1),
      percent,
      status
    };
  });
}

function gpaForRows(rows: PlanCourse[], includePlanned: boolean) {
  let unweightedPoints = 0;
  let weightedPoints = 0;
  let credits = 0;

  for (const row of rows) {
    if (!includePlanned && row.status === "planned") continue;
    const grade = row.letter_grade?.toUpperCase() ?? "";
    const points = GRADE_POINTS[grade];
    if (points === undefined) continue;
    const rowCredits = Number(row.credits ?? 0);
    if (rowCredits <= 0) continue;
    credits += rowCredits;
    unweightedPoints += points * rowCredits;
    weightedPoints += Math.min(5, points + (row.is_weighted ? 1 : 0)) * rowCredits;
  }

  return {
    credits,
    unweighted: credits > 0 ? round(unweightedPoints / credits) : null,
    weighted: credits > 0 ? round(weightedPoints / credits) : null
  };
}

export function calculateGpa(rows: PlanCourse[]): GpaSummary {
  const current = gpaForRows(rows, false);
  const projected = gpaForRows(rows, true);
  return {
    currentUnweighted: current.unweighted,
    currentWeighted: current.weighted,
    projectedUnweighted: projected.unweighted,
    projectedWeighted: projected.weighted,
    gradedCredits: projected.credits,
    isEstimate: true
  };
}

export function calculateWorkload(
  profile: StudentProfile,
  planCourses: PlanCourse[],
  courses: Course[],
  activities: Activity[]
): WorkloadSummary {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const activeCourses = planCourses.filter((course) => course.status === "current" || course.status === "planned");
  const weightedCount = activeCourses.filter((course) => course.is_weighted).length;
  const dualUnits = activeCourses.reduce((total, row) => total + Number(row.college_units ?? 0), 0);
  const weeklyActivityHours = activities.reduce((total, activity) => total + Number(activity.weekly_hours), 0);
  const yearCourseCount = activeCourses.filter((row) => {
    const catalogCourse = row.course_id ? courseMap.get(row.course_id) : null;
    return row.term === "full_year" || catalogCourse?.term_type === "year";
  }).length;
  const academicLoad = yearCourseCount * 1.2 + weightedCount * 1.5 + dualUnits * 0.8;
  const totalScore = round(academicLoad + weeklyActivityHours * 0.45, 1);
  const level = totalScore < 12 ? "light" : totalScore < 22 ? "balanced" : "high";
  const toleranceCeiling = profile.workload_tolerance === "light" ? 14 : profile.workload_tolerance === "balanced" ? 22 : 30;
  const warning =
    totalScore > toleranceCeiling
      ? "This plan is above the workload tolerance in your profile. Review honors, dual-enrollment, or activity hours."
      : null;

  return { weeklyActivityHours: round(weeklyActivityHours, 1), academicLoad: round(academicLoad, 1), totalScore, level, warning };
}

const FLOW_BY_GRADE: Record<GradeLevel, string[]> = {
  9: ["English 1", "Ethnic Studies", "Algebra 1", "Environmental Science", "Foundation in Design Thinking", "Spanish 1", "Introduction to Prototyping and Fabrication"],
  10: ["English 2", "World History", "Geometry", "Chemistry", "Co-designers", "Spanish 2", "Introduction to Visual Art"],
  11: ["English 3", "US History", "Algebra 2", "Biology", "Spanish 3"],
  12: ["English 4", "Government", "Economics", "Precalculus"]
};

export interface GeneratedPlanCourse {
  course_id: string;
  grade_level: GradeLevel;
  school_year: string;
  status: "current" | "planned";
  credits: number | null;
  is_weighted: boolean;
  mapping_verified: boolean;
  user_edited: false;
}

export function generateSuggestedPlan(
  profile: StudentProfile,
  courses: Course[],
  existing: PlanCourse[]
): GeneratedPlanCourse[] {
  const graduationYear = profile.graduation_year ?? new Date().getFullYear() + 3;
  const currentGrade = (profile.grade_level ?? 9) as GradeLevel;
  const existingIds = new Set(existing.map((row) => row.course_id).filter(Boolean));
  const generated: GeneratedPlanCourse[] = [];

  for (const grade of GRADE_LEVELS) {
    if (grade < currentGrade) continue;
    for (const courseName of FLOW_BY_GRADE[grade]) {
      const course = courses.find((candidate) => candidate.name.toLowerCase().startsWith(courseName.toLowerCase()));
      if (!course || existingIds.has(course.id)) continue;
      generated.push({
        course_id: course.id,
        grade_level: grade,
        school_year: schoolYearForGrade(graduationYear, grade),
        status: grade === currentGrade ? "current" : "planned",
        credits: course.credits,
        is_weighted: false,
        mapping_verified: course.confidence === "verified",
        user_edited: false
      });
      existingIds.add(course.id);
    }
  }

  return generated;
}

export interface GeneratedTimelineTask {
  title: string;
  category: "academics" | "activities" | "college" | "summer" | "admin";
  due_label: string;
  explanation: string;
}

export function generateTimeline(profile: StudentProfile, progress: RequirementProgress[]): GeneratedTimelineTask[] {
  const grade = (profile.grade_level ?? 9) as GradeLevel;
  const tasks: GeneratedTimelineTask[] = [];
  const missing = progress.filter((item) => item.status === "missing").slice(0, 3);

  for (const item of missing) {
    tasks.push({
      title: `Choose a course for ${item.requirement.name}`,
      category: "academics",
      due_label: "Before next course registration",
      explanation: `${item.requirement.name} is projected at ${item.verifiedProjectedCredits} of ${item.requirement.credits_required} verified credits.`
    });
  }

  if (grade <= 10) {
    tasks.push({
      title: "Record two academic or career interests",
      category: "college",
      due_label: "This semester",
      explanation: "Early interests help future course and activity suggestions stay relevant without locking in a major."
    });
  }
  if (grade === 11) {
    tasks.push({
      title: "Review senior-year rigor with a counselor",
      category: "college",
      due_label: "Before senior registration",
      explanation: "Confirm prerequisites, graduation coverage, and whether concurrent enrollment fits your workload."
    });
  }
  if (grade === 12) {
    tasks.push({
      title: "Verify final graduation requirement status",
      category: "admin",
      due_label: "Before graduation clearance",
      explanation: "Use the app as a planning aid, then confirm official transcript and requirement status with d.tech."
    });
  }

  tasks.push({
    title: "Plan one restorative summer goal",
    category: "summer",
    due_label: "Before summer",
    explanation: "Balance academic plans with rest, responsibilities, and activities."
  });
  return tasks;
}

export function overallGraduationPercent(progress: RequirementProgress[]) {
  const required = progress.reduce((total, item) => total + item.requirement.credits_required, 0);
  const projected = progress.reduce((total, item) => total + Math.min(item.verifiedProjectedCredits, item.requirement.credits_required), 0);
  return required > 0 ? clamp(Math.round((projected / required) * 100), 0, 100) : 0;
}

export function simulatePlan(
  config: SimulationConfig,
  profile: StudentProfile,
  progress: RequirementProgress[],
  gpa: GpaSummary,
  workload: WorkloadSummary
): SimulationResult {
  const graduationPercent = overallGraduationPercent(progress);
  let workloadDelta = 0;
  let stressDelta = 0;
  let activityDelta = 0;
  let gpaDelta = 0;
  const changes: string[] = [];
  const risks: string[] = [];

  if (config.pathIntensity === "competitive") {
    workloadDelta += 4;
    stressDelta += 1;
    changes.push("Adds a more rigorous academic pace.");
  } else if (config.pathIntensity === "lower_stress") {
    workloadDelta -= 3;
    stressDelta -= 1;
    changes.push("Reduces simultaneous academic pressure.");
  }

  if (config.courseStyle === "more_honors") {
    workloadDelta += 3;
    stressDelta += 1;
    gpaDelta += 0.12;
    changes.push("Uses more d.tech honors options.");
    risks.push("Weighted GPA improvement depends on strong grades and verified d.tech weighting policy.");
  }
  if (config.courseStyle === "more_dual_enrollment") {
    workloadDelta += 4;
    stressDelta += 1;
    changes.push("Adds more community-college coursework.");
    risks.push("College calendars, prerequisites, approvals, and transcript delivery must be verified.");
  }
  if (config.courseStyle === "more_regular") {
    workloadDelta -= 2;
    changes.push("Prioritizes regular d.tech course sections.");
  }

  if (config.activityLoad === "higher") {
    activityDelta = 4;
    workloadDelta += 2;
    stressDelta += 1;
    changes.push("Adds about four activity hours per week.");
  } else if (config.activityLoad === "lower") {
    activityDelta = -3;
    workloadDelta -= 2;
    changes.push("Returns about three activity hours per week.");
  }

  if (workload.totalScore + workloadDelta > 24) {
    risks.push("The simulated workload is high. Preserve time for sleep, recovery, and unexpected deadlines.");
  }
  if (profile.stress_level + stressDelta >= 5) {
    risks.push("The stress estimate reaches the top of the selected scale.");
  }

  return {
    current: {
      graduationPercent,
      projectedWeightedGpa: gpa.projectedWeighted,
      workloadScore: workload.totalScore,
      stressLevel: profile.stress_level,
      activityHours: workload.weeklyActivityHours
    },
    simulated: {
      graduationPercent,
      projectedWeightedGpa: gpa.projectedWeighted === null ? null : round(clamp(gpa.projectedWeighted + gpaDelta, 0, 5)),
      workloadScore: round(Math.max(0, workload.totalScore + workloadDelta), 1),
      stressLevel: clamp(profile.stress_level + stressDelta, 1, 5),
      activityHours: round(Math.max(0, workload.weeklyActivityHours + activityDelta), 1)
    },
    changes,
    risks
  };
}

export function fallbackSummary(
  profile: StudentProfile,
  progress: RequirementProgress[],
  gpa: GpaSummary,
  workload: WorkloadSummary
) {
  const name = profile.preferred_name || "This student";
  const missing = progress.filter((item) => item.status === "missing").map((item) => item.requirement.name);
  const gpaText = gpa.projectedWeighted === null ? "GPA needs graded courses before an estimate is available" : `projected weighted GPA is ${gpa.projectedWeighted.toFixed(2)}`;
  const requirementText = missing.length === 0 ? "all listed requirements are covered by verified current or planned courses" : `the plan still needs verified coverage for ${missing.slice(0, 3).join(", ")}`;
  return `${name}'s ${gpaText}. Based on the saved plan, ${requirementText}. Workload is currently ${workload.level}; confirm course mappings and final graduation status with d.tech counseling.`;
}
