# Contributing to AFM

## Code of Conduct

Be respectful, inclusive, and professional.

---

## How to Contribute

### 1. Fork Repository

```bash
git clone https://github.com/YOUR-USERNAME/Arcadia-For-All-Mankind.git
cd Arcadia-For-All-Mankind
```

### 2. Create Feature Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

### 3. Make Changes

- Follow code style of existing code
- Add comments for complex logic
- Test your changes locally

### 4. Commit Changes

```bash
git add .
git commit -m "feat: Add new feature" 
# or
git commit -m "fix: Fix bug in XYZ"
```

Commit message format:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Code style
- `refactor:` Code refactor
- `test:` Tests
- `chore:` Build/dependency updates

### 5. Push to GitHub

```bash
git push origin feature/your-feature-name
```

### 6. Create Pull Request

1. Go to your fork on GitHub
2. Click "Compare & pull request"
3. Add description of changes
4. Click "Create pull request"

---

## Development Setup

See QUICKSTART.md for setup instructions.

---

## Testing

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test
```

---

## Code Style

### JavaScript

- Use ES6+
- Use 2-space indentation
- Use meaningful variable names
- Add JSDoc comments

### Example

```javascript
/**
 * Calculate mission success rate
 * @param {Object} agency - Agency object
 * @param {Object} vehicle - Vehicle object
 * @returns {number} Success rate 0-100
 */
function calculateSuccessRate(agency, vehicle) {
  return agency.rp + vehicle.reliability
}
```

---

## Pull Request Guidelines

✅ **Good PR:**
- Clear description of changes
- One feature per PR
- Tests included
- No merge conflicts
- Follows code style

❌ **Avoid:**
- Large PRs (break into smaller ones)
- Multiple unrelated changes
- No description
- Failing tests
- Style violations

---

## Issues

### Reporting Bugs

Include:
- Description of bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots if applicable

### Feature Requests

Include:
- Description of feature
- Use cases
- Proposed implementation (optional)
- Priority (low/medium/high)

---

## Communication

- Use GitHub Issues for discussions
- Be respectful and constructive
- Ask questions if unclear
- Help review other PRs

---

## Resources

- README.md: Project overview
- DEPLOYMENT.md: Deployment guide
- ROADMAP.md: Project roadmap
- QUICKSTART.md: Quick setup

---

Thank you for contributing! 🎉
