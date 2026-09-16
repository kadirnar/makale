# Validation record

Validated on Linux x86_64 with a graphical session, Node.js 26.7.0, and Electron 44.4.1.

## Automated checks

- `npm run build`: TypeScript check and production renderer build passed.
- `npm test`: **22 tests passed**. Coverage includes exact token restoration, reordered Turkish grammar, malformed responses, source injection attempts, immutable formulas/code/images, HTML sanitization, SVG internal references, numeric table evidence, long-article evidence coverage, cancellation/resume, credential request handling, public URL restrictions, PDF extraction, and atomic persistence.
- `npm run test:e2e`: **4 Electron workflows passed**: full import-to-export/restart flow; original PDF rendering and extraction review; API failures; selected translation and passage locks.
- `npm audit`: **0 reported vulnerabilities** at validation time. `pdfjs-dist` is pinned to the unaffected 5.5.207 release; the initially resolved newer 5.x version was rejected by the audit.

Desktop tests use an isolated temporary library and a mocked provider. They verify both UI languages, light/dark themes, notes persistence across restart, report evidence navigation, blog generation/export, immutable mathematical elements and code, and PDF canvas rendering. They do not send user data or credentials to a test server.

## Live integration

A separate, explicit live smoke test used `google/gemini-2.5-flash-lite` through OpenRouter:

- The live catalog returned 443 text models.
- All 11 translation units in the synthetic research fixture passed identifier and protected-token validation.
- A comprehensive Turkish report was generated, followed by a second source-grounded consistency review.
- A Turkish blog draft was generated from article evidence, notes, and report.
- A real public HTML article URL imported successfully (270 source text units).

Live tests exposed and drove fixes for Turkish placeholder reordering and standalone numeric table cells missing from report evidence. The UI screenshots under `docs/screenshots/` show a live translated synthetic fixture, not measured research results from a real experiment.

## Visual review

The light reader, dark writing workspace, report, and rendered PDF fixture were inspected. The PDF fixture contains prose, a mathematical expression, and a vector pipeline figure. The app renders the original file; translation does not rewrite PDF objects. Formula and code markup are compared between the two text panes in automated tests.

## Packaged application

The x86_64 release binary passed a separate smoke test for startup, sample import, MathML rendering, PDF upload, and original PDF canvas rendering. It also launched successfully with the native Electron sandbox enabled. Packaged source files were compared to the current build, and the application archive passed a scan for the supplied credential.

## Practical limits

Tests verify preservation mechanics and tested workflows, not semantic correctness of every model response or PDF layout. Glossary detection is heuristic; unknown technical terminology requires user glossary entries or passage locks. Scanned PDFs need external OCR. Reports can still contain mistakes despite the review pass, particularly after summarizing very long papers; readers should verify claims against source evidence. URL import requires accessible public content and downloadable images. The packaged application is an unsigned x86_64 Linux build.
