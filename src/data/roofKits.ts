export interface RoofKit {
  name: string;
  desc: string;
  color: string;
}

/** All available roof kit types, keyed by their code. */
export const roofKits: Record<string, RoofKit> = {
  R_CLASS: { name: "Classroom Roof", desc: "Standard roof element for classrooms", color: "#00cec9" },
  R_CORR:  { name: "Corridor Roof",  desc: "Standard roof element for corridors",  color: "#6c5ce7" },
};
