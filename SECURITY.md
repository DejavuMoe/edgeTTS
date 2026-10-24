# Security policy

## Supported versions

Security fixes target the latest stable 1.x release. Upgrade to the latest patch
before reporting an issue; older release tags and image digests remain immutable.
Development images are not supported production releases.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/DejavuMoe/edgeTTS/security/advisories/new)
for suspected vulnerabilities. Include the affected version, configuration,
impact, and a minimal reproduction with synthetic input. Do not open a public
issue containing exploit details, API keys, raw synthesis text, or other secrets.

Maintainers will assess the report and coordinate remediation and disclosure in
the private advisory. Response times depend on maintainer availability.

## Deployment responsibilities

Use an authenticated service behind HTTPS, keep credentials out of URLs and logs,
and restrict administrative and metrics access. `/health` confirms process
availability, not upstream synthesis availability. Follow the
[deployment guide](docs/en/deployment.md) and pin production images by digest.

Repository scanning reduces known risks; a green CI run is not proof that the
service has no vulnerabilities. See the [maintainer security checks](docs/development/security-ci.md)
for coverage and limitations.
