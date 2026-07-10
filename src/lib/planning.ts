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
import { majorDirectionLabel } from "@/lib/profile-planning";

const GRADE_POINTS: Record<string, number> = {
  "A+": 4,
  A: 4,
  "A-": 4,
  "B+": 3,
  B: 3,
  "B-": 3,
  "C+": 2,
  C: 2,
  "C-": 2,
  "D+": 1,
  D: 1,
  "D-": 1,
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

export function dtechGradePoint(grade: string | null | undefined) {
  const points = GRADE_POINTS[grade?.trim().toUpperCase() ?? ""];
  return points === undefined ? null : points;
}

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

export function selectedPlanGrades(profile: StudentProfile) {
  const start = (profile.plan_start_grade ?? profile.grade_level ?? 9) as GradeLevel;
  const end = (profile.plan_end_grade ?? 12) as GradeLevel;
  return GRADE_LEVELS.filter((grade) => grade >= start && grade <= end);
}

export function requirementsForProfile(requirements: GraduationRequirement[], profile: StudentProfile) {
  if (profile.tracker_mode !== "selected") return requirements;
  const selected = new Set(profile.tracked_requirement_areas);
  return requirements.filter((requirement) => selected.has(requirement.area));
}

export function appliedCreditBreakdown({
  required,
  completed,
  current,
  planned,
  unverified = 0
}: {
  required: number;
  completed: number;
  current: number;
  planned: number;
  unverified?: number;
}) {
  const appliedCompleted = Math.min(required, completed);
  const appliedCurrent = Math.min(Math.max(0, required - appliedCompleted), current);
  const appliedPlanned = Math.min(Math.max(0, required - appliedCompleted - appliedCurrent), planned);
  const appliedTotal = appliedCompleted + appliedCurrent + appliedPlanned;
  return {
    completed: round(appliedCompleted, 1),
    current: round(appliedCurrent, 1),
    planned: round(appliedPlanned, 1),
    remaining: round(Math.max(0, required - appliedTotal), 1),
    total: round(appliedTotal, 1),
    unverified: round(unverified, 1)
  };
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
      const overrideMatches = planCourse.requirement_area_override === requirement.area;
      const mapping = planCourse.course_id
        ? (mappingsByCourse.get(planCourse.course_id) ?? []).find(
            (candidate) => candidate.requirement_id === requirement.id
          )
        : null;
      if (!overrideMatches && !mapping) continue;

      const credits = Number(planCourse.credits ?? 0);
      if ((!overrideMatches && mapping?.confidence === "uncertain") || !planCourse.mapping_verified) {
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
  let weightedCredits = 0;
  let passCredits = 0;

  for (const row of rows) {
    if (!includePlanned && row.status === "planned") continue;
    const grade = row.letter_grade?.toUpperCase() ?? "";
    const rowCredits = Number(row.credits ?? 0);
    if (grade === "P" && rowCredits > 0) {
      passCredits += rowCredits;
      continue;
    }
    const points = dtechGradePoint(grade);
    if (points === null) continue;
    if (rowCredits <= 0) continue;
    const isWeighted = row.is_weighted || Boolean(row.smccd_course_id) || Number(row.college_units ?? 0) > 0;
    credits += rowCredits;
    if (isWeighted) weightedCredits += rowCredits;
    unweightedPoints += points * rowCredits;
    weightedPoints += Math.min(5, points + (isWeighted ? 1 : 0)) * rowCredits;
  }

  return {
    credits,
    weightedCredits,
    passCredits,
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
    weightedCredits: projected.weightedCredits,
    passCredits: projected.passCredits,
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
  const currentCourses = planCourses.filter((course) => course.status === "current");
  const activeCourses = currentCourses.length > 0
    ? currentCourses
    : planCourses.filter((course) => course.status === "planned" && course.grade_level === profile.grade_level);
  const weightedCount = activeCourses.filter((row) =>
    row.is_weighted || Boolean(row.smccd_course_id) || Number(row.college_units ?? 0) > 0 || Boolean(row.course_id && courseMap.get(row.course_id)?.is_weighted)
  ).length;
  const dualUnits = activeCourses.reduce((total, row) => total + Number(row.college_units ?? 0), 0);
  const weeklyActivityHours = activities.reduce((total, activity) => total + Number(activity.weekly_hours), 0);
  const collegeWeeklyHours = round(dualUnits * 3, 1);
  const knownWeeklyHours = round(collegeWeeklyHours + weeklyActivityHours, 1);
  const capacityHours = profile.weekly_commitment_limit === null ? null : Number(profile.weekly_commitment_limit);
  const capacityRemaining = capacityHours === null ? null : round(capacityHours - knownWeeklyHours, 1);
  const demandingCourseLimit = profile.workload_tolerance === "light" ? 2 : profile.workload_tolerance === "balanced" ? 4 : 6;
  const capacityRatio = capacityHours && capacityHours > 0 ? knownWeeklyHours / capacityHours : null;
  const overLimit = weightedCount > demandingCourseLimit || (capacityRemaining !== null && capacityRemaining < 0);
  const nearLimit = weightedCount === demandingCourseLimit || (capacityRatio !== null && capacityRatio >= 0.8);
  const level = capacityHours === null
    ? "needs_input"
    : overLimit
      ? "over_limit"
      : nearLimit
        ? "near_limit"
        : "within_limit";
  const warnings = [] as string[];
  if (capacityHours === null) warnings.push("Add a weekly commitment limit in Student profile to compare this plan with your available time.");
  if (capacityRemaining !== null && capacityRemaining < 0) warnings.push(`Known commitments exceed your weekly limit by ${Math.abs(capacityRemaining)} hours.`);
  if (weightedCount > demandingCourseLimit) warnings.push(`${weightedCount} weighted or college courses exceed your selected limit of ${demandingCourseLimit}.`);
  if (profile.stress_level >= 4) warnings.push("Your current stress baseline is high, so increasing commitments should be reviewed carefully.");

  return {
    weeklyActivityHours: round(weeklyActivityHours, 1),
    collegeWeeklyHours,
    knownWeeklyHours,
    demandingCourseCount: weightedCount,
    demandingCourseLimit,
    capacityHours,
    capacityRemaining,
    academicLoad: collegeWeeklyHours,
    totalScore: knownWeeklyHours,
    level,
    warning: warnings.length ? warnings.join(" ") : null
  };
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

  for (const grade of selectedPlanGrades(profile)) {
    if (grade < currentGrade) continue;
    for (const courseName of FLOW_BY_GRADE[grade]) {
      const candidates = courses.filter((candidate) => candidate.name.toLowerCase().startsWith(courseName.toLowerCase()));
      const course = profile.goal_intensity === "competitive"
        ? candidates.find((candidate) => candidate.is_weighted || candidate.is_honors) ?? candidates[0]
        : profile.goal_intensity === "lower_stress"
          ? candidates.find((candidate) => !candidate.is_weighted && !candidate.is_honors) ?? candidates[0]
          : candidates[0];
      if (!course || existingIds.has(course.id)) continue;
      generated.push({
        course_id: course.id,
        grade_level: grade,
        school_year: schoolYearForGrade(graduationYear, grade),
        status: grade === currentGrade ? "current" : "planned",
        credits: course.credits,
        is_weighted: course.is_weighted,
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

  if (grade <= 10 && profile.academic_interests.length < 2 && !profile.career_direction.trim()) {
    tasks.push({
      title: "Record two academic or career interests",
      category: "college",
      due_label: "This semester",
      explanation: "Early interests help future course and activity suggestions stay relevant without locking in a major."
    });
  }
  if (profile.major_direction !== "undecided") {
    tasks.push({
      title: `Compare ${majorDirectionLabel(profile.major_direction)} course and SMCCD options`,
      category: "college",
      due_label: "Before next course registration",
      explanation: "Use the profile-matched catalog and associate-degree results, then verify prerequisites before changing the saved plan."
    });
  }
  if (profile.career_direction.trim()) {
    tasks.push({
      title: `Test the ${profile.career_direction.trim()} direction`,
      category: "activities",
      due_label: "This semester",
      explanation: "Choose one course, project, activity, or conversation that can confirm or challenge this career idea."
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
  let activityDelta = 0;
  let demandingCourseDelta = 0;
  const changes: string[] = [];
  const risks: string[] = [];

  if (config.majorDirection !== profile.major_direction) {
    changes.push(`Changes profile matching from ${majorDirectionLabel(profile.major_direction)} to ${majorDirectionLabel(config.majorDirection)}.`);
    risks.push("A major direction changes course and degree sorting only. It does not create requirements or alter the saved plan.");
  }

  if (config.pathIntensity === "competitive") {
    demandingCourseDelta += 1;
    changes.push("Targets one more weighted or college course, subject to the saved workload limits.");
  } else if (config.pathIntensity === "lower_stress") {
    demandingCourseDelta -= 1;
    changes.push("Targets one fewer weighted or college course.");
  }

  if (config.courseStyle === "more_honors") {
    demandingCourseDelta += 1;
    changes.push("Models one additional d.tech Honors course as demanding and weighted.");
    risks.push("No GPA change is calculated until a specific course and grade are added.");
  }
  if (config.courseStyle === "more_dual_enrollment") {
    workloadDelta += 9;
    demandingCourseDelta += 1;
    changes.push("Models one additional 3-unit SMCCD course as 9 weekly student-work hours.");
    risks.push("No GPA change is calculated until the college course and grade are added.");
    risks.push("College calendars, prerequisites, approvals, and transcript delivery must be verified.");
  }
  if (config.courseStyle === "more_regular") {
    demandingCourseDelta -= 1;
    changes.push("Models one fewer weighted or college course where a regular d.tech option exists.");
  }

  if (config.activityLoad === "higher") {
    activityDelta = 4;
    workloadDelta += 4;
    changes.push("Adds about four activity hours per week.");
  } else if (config.activityLoad === "lower") {
    activityDelta = -3;
    workloadDelta -= 3;
    changes.push("Returns about three activity hours per week.");
  }

  const simulatedHours = round(Math.max(0, workload.knownWeeklyHours + workloadDelta), 1);
  const simulatedDemandingCourses = Math.max(0, workload.demandingCourseCount + demandingCourseDelta);
  const newlyOverCapacity = workload.capacityHours !== null && simulatedHours > workload.capacityHours && workload.knownWeeklyHours <= workload.capacityHours;
  const newlyOverDemandingLimit = simulatedDemandingCourses > workload.demandingCourseLimit && workload.demandingCourseCount <= workload.demandingCourseLimit;
  const reducedLoad = workloadDelta < 0 && demandingCourseDelta <= 0;
  const stressDelta = newlyOverCapacity || newlyOverDemandingLimit ? 1 : reducedLoad ? -1 : 0;
  if (workload.capacityHours === null) risks.push("Add a weekly commitment limit before treating the workload comparison as complete.");
  else if (simulatedHours > workload.capacityHours) risks.push(`The scenario exceeds the saved weekly limit by ${round(simulatedHours - workload.capacityHours, 1)} hours.`);
  if (simulatedDemandingCourses > workload.demandingCourseLimit) risks.push(`The scenario exceeds the saved demanding-course limit by ${simulatedDemandingCourses - workload.demandingCourseLimit}.`);

  return {
    current: {
      graduationPercent,
      projectedWeightedGpa: gpa.projectedWeighted,
      workloadScore: workload.knownWeeklyHours,
      demandingCourseCount: workload.demandingCourseCount,
      stressLevel: profile.stress_level,
      activityHours: workload.weeklyActivityHours
    },
    simulated: {
      graduationPercent,
      projectedWeightedGpa: gpa.projectedWeighted,
      workloadScore: simulatedHours,
      demandingCourseCount: simulatedDemandingCourses,
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
  const workloadLevel = workload.level.replaceAll("_", " ");
  const workloadText = workload.capacityHours === null
    ? `${workload.knownWeeklyHours} known hours per week are recorded, but workload needs a saved weekly limit`
    : `${workload.knownWeeklyHours} known hours per week put the plan ${workloadLevel}`;
  return `${name}'s ${gpaText}. Based on the saved plan, ${requirementText}. ${workloadText}; confirm course mappings and final graduation status with d.tech counseling.`;
}
