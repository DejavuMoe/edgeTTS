import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// Consume pnpm's resolved graph, not its version-specific multi-document lockfile.
export function manifestsFromPnpm(projects, root) {
  const manifests = {};
  for (const project of projects) {
    const directory = path.relative(root, project.path).split(path.sep).join("/");
    assert.ok(
      !directory.startsWith("..") && !path.isAbsolute(directory),
      "Project outside workspace",
    );
    const name = directory ? `${directory}/package.json` : "package.json";
    const resolved = {};
    function visit(dependencies, scope, relationship) {
      for (const [alias, dependency] of Object.entries(dependencies ?? {})) {
        if (!dependency.version.startsWith("link:")) {
          assert.match(
            dependency.version,
            /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/,
            "Unresolved dependency",
          );
          const packageName = dependency.from ?? alias;
          assert.match(packageName, /^(?:@[\w.-]+\/)?[\w.-]+$/, "Invalid npm package name");
          const purl = `pkg:npm/${packageName.replace("@", "%40")}@${dependency.version}`;
          const previous = resolved[purl];
          resolved[purl] = {
            package_url: purl,
            relationship: previous?.relationship === "direct" ? "direct" : relationship,
            scope: previous?.scope === "runtime" ? "runtime" : scope,
          };
        }
        visit(dependency.dependencies, scope, "indirect");
        visit(dependency.optionalDependencies, scope, "indirect");
      }
    }
    visit(project.devDependencies, "development", "direct");
    visit(project.dependencies, "runtime", "direct");
    visit(project.optionalDependencies, "runtime", "direct");
    manifests[name] = { name, file: { source_location: name }, resolved };
  }
  assert.ok(
    Object.values(manifests).some((manifest) => Object.keys(manifest.resolved).length),
    "Empty dependency graph",
  );
  return manifests;
}

if (import.meta.main) {
  const { GITHUB_SHA, GITHUB_REF, GITHUB_RUN_ID, GITHUB_WORKSPACE } = process.env;
  assert.match(GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.equal(GITHUB_REF, "refs/heads/master", "Only submit trusted default-branch snapshots");
  const snapshot = {
    version: 0,
    sha: GITHUB_SHA,
    ref: GITHUB_REF,
    job: { correlator: "pnpm-resolved-dependencies", id: GITHUB_RUN_ID },
    detector: {
      name: "edgetts-pnpm-list",
      version: "1.0.0",
      url: "https://github.com/DejavuMoe/edgeTTS",
    },
    scanned: new Date().toISOString(),
    manifests: manifestsFromPnpm(
      JSON.parse(readFileSync(process.argv[2], "utf8")),
      GITHUB_WORKSPACE,
    ),
  };
  process.stdout.write(JSON.stringify(snapshot));
}
