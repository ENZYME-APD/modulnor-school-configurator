# Contributing to Modulnor School Configurator

Thank you for contributing! This document describes our development workflow.

> [!IMPORTANT]
> This is proprietary software owned by **ENZYME APD**. All contributions become the property of ENZYME APD. Only authorised team members may contribute.

---

## Branching Strategy

We use a simple **feature-branch workflow** off `main`.

| Branch prefix | Purpose | Example |
|---|---|---|
| `feat/` | New feature or capability | `feat/bom-pdf-export` |
| `fix/` | Bug fix | `fix/ifc-loader-crash` |
| `chore/` | Maintenance, tooling, deps | `chore/update-thatopen-3.3` |
| `docs/` | Documentation only | `docs/update-readme` |
| `refactor/` | Code restructure (no behaviour change) | `refactor/split-main-ts` |

**Rules:**
- Branch off `main`
- Keep branches short-lived (aim to merge within a sprint)
- Delete branches after merging

---

## Commit Message Style

We follow **[Conventional Commits](https://www.conventionalcommits.org/)**:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`

**Examples:**

```
feat(bom): add roof system line items to BOM export
fix(ifc): handle missing geometry in structural fragments
chore(deps): upgrade @thatopen/components to 3.3.0
docs: update project structure in README
```

---

## Pull Request Process

1. **Create a branch** from `main` using the naming convention above.
2. **Make your changes** — keep PRs focused on a single concern.
3. **Verify locally** before opening a PR:
   ```bash
   npm run build        # Must pass with no errors
   ```
4. **Open a PR** against `main`, filling in the PR template.
5. **Request review** from at least one team member.
6. **Merge** using **Squash and Merge** to keep `main` history clean.

---

## Code Style

- **TypeScript strict mode** is enabled — avoid `any` types.
- **ESLint + Prettier** are configured. Run before committing:
  ```bash
  npx eslint src --fix
  ```
- Keep functions small and well-named.
- Add JSDoc comments to exported functions and classes.

---

## Excel Datasets

If you update any `*_excel/` source file, regenerate the BOM:

```bash
node generate_bom.mjs
```

Commit the updated `src/bom.json` alongside your Excel changes.
