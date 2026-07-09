import { z } from "zod";

const publicEnvSchema = z.object({
  PUBLIC_SUPABASE_URL: z.url(),
  PUBLIC_SUPABASE_ANON_KEY: z.string().min(20)
});

export function getPublicEnv() {
  return publicEnvSchema.parse({
    PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY: import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  });
}

export function hasPublicEnv() {
  return publicEnvSchema.safeParse({
    PUBLIC_SUPABASE_URL: import.meta.env.PUBLIC_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY: import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  }).success;
}
