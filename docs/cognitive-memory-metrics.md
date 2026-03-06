# Cognitive Memory Metrics

## Metrics

1. **recall_reuse_rate**
   - Definition: average recalled memories per recall call (`sum(reusedCount) / recall_calls`).
   - Source: `memory_recall_logs.reusedCount`.

2. **contradiction_resolution_count**
   - Definition: number of memories recorded with `contradictionWithMemoryId` (proxy for contradiction handling activity).
   - Source: `memories.contradictionWithMemoryId`.

3. **review_rejection_proxy**
   - Definition: ratio of reviewed low-confidence recalls rejected (`rejected / requiresReview`).
   - Source: `memory_recall_logs.requiresReview`, `reviewOutcome`.

4. **avg_time-to-review proxy**
   - Definition: average `(reviewedAt - createdAt)` in ms for recall logs that were reviewed.
   - Source: `memory_recall_logs.reviewedAt`, `createdAt`.

5. **cost/token proxy placeholders**
   - Definition: aggregate token proxy from recall calls (currently query length placeholder).
   - Source: `memory_recall_logs.tokenCostProxy`.

## Collection points

- Recall logging: `convex/missionControl.ts` -> `recall` mutation writes `memory_recall_logs`.
- Review outcome logging: `reviewRecallLog` mutation.
- Contradiction events: `remember`/`extractAndRemember` via consolidation logic.
- Reporting endpoint: `GET /mission-control/memory/metrics`.
- Scripted report: `scripts/memory_metrics_report.py`.
- Seeded end-to-end validation: `scripts/memory_seeded_e2e.py` (remember -> recall -> review -> metrics).
