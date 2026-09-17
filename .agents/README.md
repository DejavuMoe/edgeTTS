# Shared project-local agent skills

## security-audit

- Source: <https://github.com/cloudflare/security-audit-skill>
- Revision: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`
- Installed at: `.agents/skills/security-audit/` (from the repository root)
- License: MIT; the upstream license is included in the skill directory.

The skill directory is an unmodified copy of the upstream
`skills/security-audit/` directory, plus its license. No global settings or
application dependencies are needed. Agents that support `.agents/skills/`,
including Pi, discover this shared project-local directory. This is not the
singular `.agent/skills/` or Pi-specific `.pi/skills/` directory; agents with other
discovery conventions may need an explicit skill-path setting.

In Pi, reload or start a new session in this trusted project, then use
`/skill:security-audit`.

Repository rules in `AGENTS.md` still apply. Installation does not authorize
subagents or writes outside this repository. Before requesting the skill's full
multi-agent workflow, explicitly authorize subagents and select a Git-ignored
output directory inside this repository. Its sandbox requirements still apply.

To update, review a new upstream revision, replace the vendored directory and
license, and update the revision above. Keep upstream files byte-for-byte intact;
the repository's format and lint checks exclude only this vendored skill.
