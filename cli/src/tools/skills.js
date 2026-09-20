// roforge_skill — loads a RoForge skill playbook (ECC-style progressive disclosure).
// Runs locally: no bridge, no network. Returns the skill body for the model to follow.
import { getSkill, listSkills } from "../skills.js";

export function skillTools() {
  return [
    {
      name: "roforge_skill",
      description:
        "Load a RoForge skill: a step-by-step playbook for a specific Roblox job " +
        "(obby courses, player/character work, UI/HUD, DataStore saves, monetization, visuals). " +
        "Call it BEFORE starting work that matches a skill in your system prompt's Skills list, " +
        "and follow the returned playbook (exact tool calls, attribute contracts, pitfalls).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name from the Skills list (e.g. 'obby-course')" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      execute(args) {
        const name = String(args.name || "").trim();
        if (!name) return "ERROR: name is required. Available: " + listSkills().map((s) => s.name).join(", ");
        const body = getSkill(name);
        if (!body) {
          return (
            `ERROR: no skill named '${name}'. Available skills: ` +
            listSkills()
              .map((s) => s.name)
              .join(", ")
          );
        }
        return `Skill '${name}' playbook — follow it:\n\n${body}`;
      },
    },
  ];
}
