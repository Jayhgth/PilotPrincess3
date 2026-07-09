import type { Course, SmccdProgram, StudentProfile } from "@/lib/models";

export const MAJOR_DIRECTION_OPTIONS = [
  { value: "undecided", label: "Exploring", description: "Keep course and degree matches broad." },
  { value: "stem", label: "STEM", description: "Prioritize computing, engineering, math, and science matches." },
  { value: "business", label: "Business", description: "Prioritize business, economics, accounting, and leadership matches." },
  { value: "humanities", label: "Humanities", description: "Prioritize writing, arts, history, language, and social science matches." },
  { value: "health", label: "Health", description: "Prioritize biology, health science, psychology, and wellness matches." }
] as const;

export const ACADEMIC_INTEREST_OPTIONS = [
  "Computer science",
  "Engineering",
  "Math and data",
  "Biology and health",
  "Business and economics",
  "Writing and humanities",
  "Social science and policy",
  "Arts and design",
  "Languages and culture"
] as const;

const MAJOR_KEYWORDS: Record<string, string[]> = {
  stem: ["computer", "computing", "engineering", "mathematics", "math", "data", "physics", "chemistry", "biology", "technology"],
  business: ["business", "economics", "accounting", "finance", "marketing", "management", "entrepreneur", "leadership"],
  humanities: ["english", "writing", "history", "humanities", "philosophy", "language", "art", "design", "social science", "political"],
  health: ["health", "biology", "nursing", "medical", "medicine", "psychology", "wellness", "kinesiology", "nutrition"]
};

const INTEREST_KEYWORDS: Record<string, string[]> = {
  "computer science": ["computer science", "computer", "computing", "programming", "software", "cybersecurity", "cyber security", "informatics", "information technology"],
  engineering: ["engineering", "robotics", "electrical", "mechanical", "mechatronics"],
  "math and data": ["mathematics", "math", "data", "statistics", "analytics", "calculus"],
  "biology and health": ["biology", "health", "nursing", "medical", "medicine", "anatomy", "physiology", "nutrition"],
  "business and economics": ["business", "economics", "accounting", "finance", "management", "marketing", "entrepreneurship"],
  "writing and humanities": ["english", "writing", "literature", "humanities", "history", "philosophy"],
  "social science and policy": ["social science", "political science", "policy", "sociology", "anthropology", "psychology", "government"],
  "arts and design": ["art", "design", "music", "theater", "photography", "animation"],
  "languages and culture": ["language", "culture", "spanish", "french", "chinese", "japanese"]
};

const MAJOR_SUBJECTS: Record<string, string[]> = {
  stem: ["Mathematics", "Laboratory Science", "Design Lab"],
  business: ["Mathematics", "Social Science", "Design Lab"],
  humanities: ["English", "Social Science", "Visual and Performing Arts", "World Language", "Design Lab"],
  health: ["Laboratory Science", "Personal Development", "Mathematics"]
};

export function majorDirectionLabel(value: string) {
  return MAJOR_DIRECTION_OPTIONS.find((option) => option.value === value)?.label ?? "Exploring";
}

function meaningfulTokens(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4);
}

function includesKeyword(haystack: string, keyword: string) {
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

function interestMatches(haystack: string, interest: string) {
  const normalized = interest.toLowerCase().trim();
  const curatedKeywords = INTEREST_KEYWORDS[normalized];
  if (curatedKeywords) return curatedKeywords.some((keyword) => includesKeyword(haystack, keyword));
  const tokens = meaningfulTokens(normalized);
  return tokens.length > 0 && tokens.every((token) => includesKeyword(haystack, token));
}

export function courseProfileFit(course: Course, profile: StudentProfile) {
  if (profile.major_direction === "undecided" && profile.academic_interests.length === 0 && !profile.career_direction.trim()) {
    return { score: 0, reasons: [] as string[] };
  }

  const haystack = `${course.name} ${course.subject} ${course.description ?? ""}`.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const subjects = MAJOR_SUBJECTS[profile.major_direction] ?? [];
  if (subjects.includes(course.subject)) {
    score += 3;
    reasons.push(`${majorDirectionLabel(profile.major_direction)} subject match`);
  }

  const matchedInterest = profile.academic_interests.find((interest) => interestMatches(haystack, interest));
  if (matchedInterest) {
    score += 4;
    reasons.push(`Matches ${matchedInterest.toLowerCase()}`);
  }

  const careerMatch = meaningfulTokens(profile.career_direction).find((token) => includesKeyword(haystack, token));
  if (careerMatch) {
    score += 4;
    reasons.push(`Matches career keyword "${careerMatch}"`);
  }

  if ((MAJOR_KEYWORDS[profile.major_direction] ?? []).some((keyword) => includesKeyword(haystack, keyword))) score += 1;
  return { score, reasons: reasons.slice(0, 2) };
}

export function programProfileFit(program: SmccdProgram, profile: StudentProfile) {
  const title = program.title.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const matchedInterest = profile.academic_interests.find((interest) => interestMatches(title, interest));
  if (matchedInterest) {
    score += 4;
    reasons.push(`Matches ${matchedInterest.toLowerCase()}`);
  }
  const careerMatch = meaningfulTokens(profile.career_direction).find((token) => includesKeyword(title, token));
  if (careerMatch) {
    score += 4;
    reasons.push(`Matches career keyword "${careerMatch}"`);
  }
  if ((MAJOR_KEYWORDS[profile.major_direction] ?? []).some((keyword) => includesKeyword(title, keyword))) {
    score += 2;
    reasons.push(`${majorDirectionLabel(profile.major_direction)} direction match`);
  }
  return { score, reasons: [...new Set(reasons)].slice(0, 2) };
}
