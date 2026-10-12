import { secretObjectives } from "@/entities/data/secretObjectives";
import { indexBy } from "@/entities/lookup/indexBy";
import type { SecretObjective } from "@/entities/data/types";

const secretObjectivesMap = indexBy(secretObjectives, (obj) => obj.alias);

export function getSecretObjectiveData(
  objectiveAlias: string
): SecretObjective | undefined {
  return secretObjectivesMap.get(objectiveAlias);
}

const byName = indexBy(secretObjectives, (obj) => obj.name.toLowerCase());

/** A secret objective by its printed name (prompts that only carry the label). */
export function getSecretObjectiveByName(name: string): SecretObjective | undefined {
  return byName.get(name.trim().toLowerCase());
}
