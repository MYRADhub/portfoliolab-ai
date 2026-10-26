import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@portfolio-lab/db";

const settings: Record<string, string | undefined> = {};
vi.mock("./env", () => ({ env: () => settings }));

const { enroll, studyInfo } = await import("./experiment");

const APPROVED = {
  STUDY_RESEARCHER: "A. Student, Example High School",
  STUDY_APPROVAL: "Ms Example, Economics, 2026-11-01",
  STUDY_CONTACT: "teacher@example.org",
  STUDY_RETENTION: "Until 2027-06-30, then deleted.",
};
const input = {
  consent: true as const,
  ageGroup: "minor" as const,
  experience: "novice" as const,
  pre: { perceivedDiversification: 3, confidence: 3 },
};
// The checks run before the database is touched, so an empty object stands in for it.
const noDb = {} as Db;

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
});

describe("studyInfo", () => {
  it("is null until every required approval detail is set", () => {
    expect(studyInfo()).toBeNull();
    Object.assign(settings, APPROVED, { STUDY_CONTACT: undefined });
    expect(studyInfo()).toBeNull();
    Object.assign(settings, APPROVED);
    expect(studyInfo()).toMatchObject({
      contact: "teacher@example.org",
      end: null,
      allowMinors: false,
    });
  });
});

describe("enroll gates", () => {
  it("refuses everyone while the study is not approved", async () => {
    await expect(enroll(noDb, { ...input, ageGroup: "adult" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("refuses minors unless the study allows them", async () => {
    Object.assign(settings, APPROVED);
    await expect(enroll(noDb, { ...input, guardianConsent: true })).rejects.toMatchObject({
      code: "forbidden",
    });
    settings.STUDY_ALLOW_MINORS = "1";
    await expect(enroll(noDb, input)).rejects.toMatchObject({ code: "bad_request" });
  });
});
