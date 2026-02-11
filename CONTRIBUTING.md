# Contributing to AgentGate

## Development Workflow

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Create a feature branch: `git checkout -b feat/my-feature`
4. Make changes, write tests
5. Run checks locally before pushing:
   ```bash
   pnpm build
   pnpm test
   pnpm audit --audit-level=high
   ```
6. Open a pull request against `main`

## CI Pipeline

Pull requests run the following checks automatically:

- **Install** — `pnpm install --frozen-lockfile`
- **Build** — `pnpm build`
- **Test** — `pnpm test`
- **Dependency Audit** — `pnpm audit --audit-level=high`

All checks must pass before merging.

## Handling Audit Failures

The CI pipeline runs `pnpm audit --audit-level=high`, which fails on **high** or **critical** severity vulnerabilities. Moderate and low severities are reported but do not block the build.

### When the audit fails

1. **Check what's vulnerable:**
   ```bash
   pnpm audit
   ```

2. **Update the vulnerable package:**
   ```bash
   pnpm update <package-name>
   ```

3. **If no fix is available yet:**
   - Check the advisory for workarounds
   - If the vulnerability doesn't affect your usage (e.g., dev-only dependency, unreachable code path), document the decision in your PR description
   - Use `pnpm audit --fix` to attempt automatic resolution
   - As a last resort, consider replacing the dependency

4. **Transitive dependencies:** If the vulnerability is in a transitive dependency you don't control, open an issue upstream and document it in your PR

### Running the audit locally

```bash
# Same command as CI
pnpm audit --audit-level=high

# Full report including low/moderate
pnpm audit
```
