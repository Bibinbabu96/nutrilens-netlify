# NutriLens — Gemini Netlify backend

This replaces the OpenAI Netlify backend. No iPhone code change is required if your installed app already handles background analysis (HTTP 202).

## Update your existing GitHub repository

1. Extract NutriLens-Gemini-Netlify.zip.
2. Open the GitHub repository connected to Netlify. Go to the folder currently containing package.json and netlify.toml (usually the repository root).
3. Choose Add file > Upload files. Upload the CONTENTS of the extracted folder, including lib, netlify, public, package.json, package-lock.json, netlify.toml, test.mjs, gemini.test.mjs and this README. Replace existing files at the SAME paths; do not add another nested backend folder. Commit the changes to the branch Netlify deploys.
4. In Netlify environment variables, set GEMINI_API_KEY to your Google AI Studio API key. Set GEMINI_MODEL to gemini-2.5-flash-lite (also the default). Keep APP_ACCESS_TOKEN exactly the same as the connection token in the iPhone app. Use Functions scope and the Production deployment context (or all contexts if appropriate).
5. Old OPENAI_API_KEY and OPENAI_MODEL variables are unused by this version and may be removed. Never put any real secret in GitHub or the iPhone app.
6. Redeploy after both the GitHub commit and environment updates. Existing build settings remain: npm run build; publish public; functions netlify/functions; Node 22.
7. Open https://YOUR-SITE.netlify.app/health. It should return:

```json
{"status":"ok","mode":"background","provider":"gemini","model":"gemini-2.5-flash-lite"}
```

This checks configuration and storage, not whether Google accepts your key or provides quota. If provider is absent, an old deployment or a different site is being used.
8. Keep the same site address and APP_ACCESS_TOKEN in the iPhone app. Test one clear nutrition + ingredients label first, with comparison off.

## Free-tier testing and errors

Google lists standard Gemini 2.5 Flash-Lite input/output on its free tier, subject to project/model quotas and regional eligibility. Keep your Google project on the free tier for free API testing. Using a paid-tier project may incur charges. Netlify has its own hosting usage limits. This backend never falls back to OpenAI or another model.

Gemini 429: check AI Studio > Rate Limit for the same project and model. Do not assume a zero quota can be fixed by waiting. Temporary limits require waiting for reset; daily limits have their own reset. Avoid repeated scans while a limit is reached. NutriLens separately accepts at most 30 jobs/hour.
Gemini access denied: verify the key, project, API restrictions and region eligibility.
Gemini model unavailable: select a model available to your project using GEMINI_MODEL and redeploy.
HTTP 202 shown as an error: install the newer iOS build with background-job polling from the prior NutriLens package.

## Data and reports

OCR stays on the phone; extracted label text and the saved fitness goal go to Netlify and Google. Google's free-tier terms permit submitted content to be used for product improvement. Test with public packaging, without personal information. Jobs/reports are temporarily stored in private Netlify Blobs, expire after an hour, and are deleted when the app retrieves the report; scheduled cleanup removes expired records. Deletion from Netlify does not control Google's retention.

The report structure and existing scoring formulas are unchanged. Scores are unvalidated nutrition/goal-fit heuristics, never a safety probability. Ingredient analysis is model-generated without live verification. Missing nutrients remain unknown. A label cannot establish personal safety or certify absence of allergens or contamination.

## Verification

Run npm ci, then npm test and npm run build with Node 22. The 21 automated tests use mocked provider responses and cover report validation, one/five scans, Gemini errors, job/authentication handling, duplicate prevention and runtime configuration. Live Gemini and iPhone testing still require your deployment and device.

References checked October 1, 2026:
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/troubleshooting
