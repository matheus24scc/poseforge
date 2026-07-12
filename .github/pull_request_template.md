<!-- Thanks for contributing to Poseforge! Please fill this in. -->

## Summary

<!-- What does this PR do, and why? -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Pose / animation content (freely-licensed source)
- [ ] Docs
- [ ] Refactor / performance
- [ ] Other:

## How was this tested?

<!-- Steps you took to verify. If it touches pose math, mention the scripts/ test you ran. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes (dev server stopped first)
- [ ] Provider calls stay in the stateless, `fetch`-only API routes (no Node-native server deps)
- [ ] Any new expensive provider call is recorded as a durable job that resumes on reload
- [ ] Pose-math changes verified with the `scripts/` Node tests, not just by eye
- [ ] Any bundled pose/clip content comes from a freely-licensed source (no Mixamo/AMASS redistribution)
- [ ] Commits are focused and messages are descriptive
