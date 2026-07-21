import type {
  Course,
  CourseRequirementMapping,
  GraduationRequirement,
  PlanCourse,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGoal
} from "@/lib/models";
import type { PlannerPrerequisiteEvaluation } from "@/lib/prerequisites";
import { prerequisiteWarningDetail } from "@/lib/prerequisite-display";
import { normalizeSmccdCourseCode } from "@/lib/smccd";

export interface CoursePlanEvidence {
  title: string;
  detail: string;
  verified: boolean;
  tone?: "verified" | "advisory" | "danger";
}

export function coursePlanEvidence(input: {
  row: PlanCourse;
  course?: Course | null;
  collegeCourse?: SmccdCourse | null;
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  goals: StudentSmccdGoal[];
  programs: SmccdProgram[];
  degreeRequirements: SmccdProgramRequirement[];
  degreeRequirementCourses: SmccdRequirementCourse[];
  prerequisiteEvaluation?: PlannerPrerequisiteEvaluation | null;
}): CoursePlanEvidence[] {
  const evidence: CoursePlanEvidence[] = [];
  const prerequisiteWarning = input.prerequisiteEvaluation
    ? prerequisiteWarningDetail(input.prerequisiteEvaluation)
    : null;
  if (prerequisiteWarning) evidence.push({
    title: "Prerequisite not found earlier",
    detail: prerequisiteWarning,
    verified: false,
    tone: "danger"
  });
  const requirementById = new Map(input.requirements.map((requirement) => [requirement.id, requirement]));
  if (input.course) {
    const mapped = input.mappings.filter((mapping) => mapping.course_id === input.course?.id);
    for (const mapping of mapped) {
      const requirement = requirementById.get(mapping.requirement_id);
      if (!requirement) continue;
      evidence.push({
        title: requirement.name,
        detail: `${Number(input.row.credits ?? input.course.credits ?? 0)} high-school credits toward this diploma area.`,
        verified: mapping.confidence === "verified" || mapping.is_user_override
      });
    }
  }

  if (input.collegeCourse) {
    const normalized = normalizeSmccdCourseCode(input.collegeCourse.course_code);
    const equivalency = input.equivalencies.find((item) => normalizeSmccdCourseCode(item.college_course_code) === normalized);
    if (equivalency) {
      evidence.push({
        title: "High-school overlap",
        detail: `${equivalency.high_school_credits} credits toward ${equivalency.requirement_area.replaceAll("_", " ")} from the reviewed dual-enrollment equivalency.`,
        verified: equivalency.confidence === "verified"
      });
    }
    const programById = new Map(input.programs.map((program) => [program.id, program]));
    const goalPrograms = new Set(input.goals.map((goal) => goal.program_id));
    const requirementByCourse = input.degreeRequirementCourses.filter((option) => normalizeSmccdCourseCode(option.course_code) === normalized);
    for (const option of requirementByCourse) {
      const requirement = input.degreeRequirements.find((candidate) => candidate.id === option.requirement_id && goalPrograms.has(candidate.program_id));
      if (!requirement) continue;
      const program = programById.get(requirement.program_id);
      evidence.push({
        title: program ? `${program.title} (${program.college_code})` : "Bookmarked degree",
        detail: `Listed for ${requirement.label}.`,
        verified: true
      });
    }
  }

  if (input.row.requirement_area_override && evidence.length === 0) {
    evidence.push({
      title: "Student-provided requirement mapping",
      detail: `Counted toward ${input.row.requirement_area_override.replaceAll("_", " ")}.`,
      verified: false
    });
  }
  if (input.row.notes?.trim()) evidence.push({ title: "Plan note", detail: input.row.notes.trim(), verified: input.row.mapping_verified });
  if (evidence.length === 0) evidence.push({
    title: input.row.mapping_verified ? "Verified catalog course" : "Plan choice",
    detail: input.row.mapping_verified ? "The course identity is verified, but no additional requirement claim is attached here." : "No verified diploma or bookmarked-degree claim is attached to this course.",
    verified: input.row.mapping_verified
  });
  return evidence;
}
