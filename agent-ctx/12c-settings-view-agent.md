# Task 12c — settings-view-agent

## File delivered
- `src/components/views/settings-view.tsx` (~880 lines, replaced the 1-line stub)

## Sections implemented (5 Tabs)
1. **General** — appName (max 60 + counter), appNameFr (max 80 + counter), defaultLanguage Select (en/fr), currency Input (uppercase, max 8), timezone Select (24 IANA zones, scrollable). Footer: Restore default + Save.
2. **Appearance** — two-button radio for light/dark theme with active border + Active badge.
3. **Financial** — referenceMonthlyIncome + allocationUnitValue numeric inputs (with currency badge suffix) and an allowOverdraft Switch row. Footer: Save.
4. **Security** — change password form (current/new/confirm) with live strength meter + inline validation, plus a session info card with name/email/language/theme badges and a destructive Sign out button.
5. **Data management** — CSV exports grid (4 modules), bilingual `pg_dump`/`pg_restore`/`psql` backup/restore docs, dev SQLite file note (`db/custom.db`), and a Data portability card.

## API wiring
- `GET /api/auth/me` and `GET /api/settings` via `useQuery(['me'])` / `useQuery(['settings'])`.
- `PUT /api/settings` (general + financial save), `PATCH /api/settings/branding-restore`, `PUT /api/auth/preferences` (language + theme), `PUT /api/auth/password` (with `throwOnError:false` so the 400 wrong-password case renders a localized toast), `POST /api/auth/logout` (then reload).
- CSV exports: `window.location.href = '/api/${module}/export'` for income / expenses / wallets / goals.

## Store integration
- `setBranding(appName, appNameFr)` after every successful general save and after branding restore so the sidebar / header / login page update live.
- `setLocale(language)` after general save and `setTheme(theme)` on theme toggle.
- `document.title` synced to the locale-appropriate name via `useEffect`.

## Lint / TS / Dev
- `bun run lint` → 0 errors in `settings-view.tsx` (only the pre-existing warning in `src/components/boot.tsx`).
- `bunx tsc --noEmit --skipLibCheck` → 0 errors in `settings-view.tsx`.
- `dev.log` → `GET / 200`, no compile errors after the write.

## Notes
- The Prisma `AppSettings` model does **not** have a `defaultLanguage` column, so the form sources the user's language from `me.user.language` and persists it via `/api/auth/preferences` rather than via `PUT /api/settings`. The PUT body only contains fields that exist in the schema (`appName, appNameFr, defaultCurrency, defaultTimezone, referenceMonthlyIncome, allocationUnitValue, allowOverdraft`).
