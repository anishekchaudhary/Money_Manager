# Personal Money Management PWA: setup and deployment

This guide is for the single-owner app in this directory. The app code runs locally on your Mac, Vercel serves the website, and Supabase stores the financial data and handles sign-in. No paid plan or custom domain is required for ordinary personal use. Use the [design plan](DESIGN_PLAN.md) to understand the money rules before entering real balances.

Think of **GitHub** as the private copy of the app's code, **Vercel** as the machine that serves the website, and **Supabase** as the locked record book shared by your phone and PC. A **migration** is a versioned instruction that creates or changes the database. **RLS** is the database rule that limits records to your owner account. Installing the **PWA** puts a shortcut to the same website on a device; the data stays in Supabase.

**Where to run commands:** Open Terminal on your Mac. Commands below assume the project is at `/Users/anishech/Time_Management`. Commands beginning with `npx supabase` affect the Supabase project linked in this directory, so check the project name before every database push. Uppercase values ending in `_HERE` are placeholders: replace the whole value with your own before running the command.

**Private information:** Never put a database password, Supabase secret/service-role key, personal financial data, or a backup passphrase in GitHub, this guide, a screenshot, or a chat. The two `NEXT_PUBLIC_...` settings below are intended for the browser, but the database must still be protected by Row Level Security (RLS). Keep `.env.local` out of Git.

## 1. Check the Mac and install Node.js if needed

In Terminal:

```bash
cd /Users/anishech/Time_Management
node --version
npm --version
git --version
```

Expected: each command prints a version. If `node` or `npm` says `command not found`, install the current **LTS** macOS package from [Node.js Downloads](https://nodejs.org/en/download), then close and reopen Terminal and repeat the checks. Git is supplied by Xcode Command Line Tools on many Macs; if `git` is missing, run `xcode-select --install` and repeat the check. The app and Supabase CLI need a modern Node.js; Supabase's npm-installed CLI requires Node 20 or newer. [Supabase CLI installation](https://supabase.com/docs/guides/local-development/cli/getting-started).

Stop here if any version command still fails. Do not continue with a partially installed runtime.

## 2. Understand the two Supabase projects

Plan for two long-lived projects on the **Supabase Free** plan, plus one temporary recovery rehearsal that will be paused before production is created:

| Project | Purpose | Contains |
| --- | --- | --- |
| `money-dev` | Local testing and Vercel preview builds | Sample money only |
| `money-prod` | Your everyday app | Real private financial records |
| `money-restore-test` | Temporary backup rehearsal before production | A restored copy of development samples; pause it afterward |

As checked on 5 October 2026, Supabase allows two active Free projects per eligible account. A free project may pause after low activity and has no automatic database backups, so the backup steps below matter. Check the terms again before creating the projects. If you have only one free slot available, use it for development first and wait to create production until a second slot is available; keep test and real money records separate. [Supabase Free plan](https://supabase.com/docs/guides/platform/billing-on-supabase), [backups](https://supabase.com/docs/guides/platform/backups), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

Create a Supabase account at [supabase.com](https://supabase.com). In its dashboard, choose **New project**, select a Free organization, name the first project `money-dev`, choose a region near you, and create a strong database password. Save that password in your password manager; it is used for database administration and is **not** the app sign-in password. Wait for project creation to finish.

In the new project's **Connect** panel, record privately:

- Project URL, which looks like `https://<project-ref>.supabase.co` https://xqpppxixrkcinqhrnpnn.supabase.co
- Publishable key, which starts with `sb_publishable_` sb_publishable_VGoLeuaZZrTGaszGPxchTA_UKEDZN4F
- Project reference, visible in the dashboard URL after `/project/` xqpppxixrkcinqhrnpnn

Supabase documents these values in its [Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs). Do not use the secret/service-role key as the publishable key.

## 3. Install this project's dependencies

From the project directory:

```bash
cd /Users/anishech/Time_Management
npm install
```

Expected: the command exits successfully and creates `node_modules`. Warnings about optional packages can occur, but stop if npm prints `ERR!` or exits nonzero. `node_modules` is generated locally and should not be committed.

Then check that the Supabase CLI is available through the project:

```bash
npx supabase --version
```

Expected: a version number. If the CLI is not yet listed as a development dependency, run `npm install --save-dev supabase`, then repeat. The CLI is installed in the project and invoked as `npx supabase ...`; no global CLI or local Docker stack is required just to push migrations to a hosted project. [Supabase CLI installation](https://supabase.com/docs/guides/local-development/cli/getting-started).

## 4. Create the development database from versioned migrations

The SQL files in `supabase/migrations/` define the tables, constraints, and security rules. Apply them to `money-dev` first. Do not hand-create the same tables in the Dashboard: remote manual schema edits bypass migration history and can make later pushes fail. [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

The CLI needs a `supabase/config.toml` file. Check it:

```bash
ls supabase/config.toml
```

Expected: the path prints. If it says the file is missing, run `npx supabase init` once from this project directory, then check again. Do not overwrite an existing config or migration folder. Supabase documents `init` as the CLI's project setup step. [Supabase CLI setup](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
npx supabase login
npx supabase link --project-ref DEV_PROJECT_REF_HERE
npx supabase projects list
npx supabase db push --dry-run
```

The login opens a browser or asks for a Supabase access token. The link step may ask for the **development** project's database password. Its expected result is `Finished supabase link.` In `projects list`, check the linked-project indicator and exact project reference against **money-dev** in the dashboard. The dry run previews which local migration files would be pushed; it may not print a human-readable project name. **Stop if the linked reference is not development or the migration list is unexpected.** [Supabase CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows).

If the dry run is correct:

```bash
npx supabase db push
```

Expected: the listed migrations apply without error. A later repeat should say `Linked project is up to date.` The CLI documents `--dry-run` and keeps a migration history so applied migrations are not replayed. [Supabase CLI `db push`](https://supabase.com/docs/reference/cli/supabase-db-push).

In Supabase, open **Database → Tables** and confirm the app's tables exist. For each financial table, RLS must be enabled. You can verify the central tables with this **read-only** SQL Editor query:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'app_owner', 'accounts', 'transactions', 'entries',
    'goals', 'goal_allocations', 'monthly_plans', 'plan_items', 'alert_states'
  )
order by tablename;
```

Expected: every listed table has `rowsecurity = true`; a missing table or `false` is a stop point. The migration should restrict reads and writes to the designated owner ID. Do not turn off RLS to fix a sign-in or permission error: use the troubleshooting section and inspect the policy instead. [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 5. Configure the local app

If `.env.local` already exists, edit it rather than replacing it. Otherwise copy the example settings file:

```bash
cp .env.example .env.local
```

Open `.env.local` in your editor and replace the placeholders with values from **money-dev**:

```text
NEXT_PUBLIC_SUPABASE_URL=PASTE_DEV_PROJECT_URL_HERE
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=PASTE_DEV_PUBLISHABLE_KEY_HERE
```

There should be no quotes around the values and no space around `=`. The URL and publishable key are paired: using the URL of one project with another project's key will fail.

Check that Git will ignore the file:

```bash
git check-ignore .env.local
```

Expected: `.env.local`. If the directory is not yet a Git repository, check `.gitignore` directly for its `.env.local` entry and repeat `git check-ignore` after step 8. **Stop before pushing to GitHub if `.env.local` is not ignored.** The [Supabase Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs) uses these public settings for browser access; RLS determines which rows can be accessed.

## 6. Set up your one owner account

The app has a sign-in screen but no public sign-up screen. In the `money-dev` Supabase dashboard, open **Authentication → Users → Add user → Create new user**. Enter an email address you control and a strong, unique app password. If the form offers **Auto Confirm User**, select it after checking the email address carefully. Save and confirm that the user appears in the Users list. This dashboard action creates the app identity; it does not add any financial records. Supabase documents the [Users dashboard](https://supabase.com/docs/guides/auth/users) and the corresponding [admin user-creation operation](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

If that exact menu has changed, look for the dashboard's manual user-creation control. Do not switch on public sign-up or put a secret/service-role key in the app to create the user. Stop and inspect the current Supabase user-management instructions if you cannot find the manual control.

Immediately after the owner is present, open the Supabase **Authentication** settings and turn off **Allow new users to sign up**. Existing users can still sign in with this disabled. Keep anonymous sign-ins disabled. Repeat this process in the production project later. [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration).

This repository's migration has one additional single-owner lock: `public.app_owner`. In **Authentication → Users**, copy the newly created user's UUID. In **SQL Editor** of **money-dev**, first check that no owner is already designated:

```sql
select owner_id from public.app_owner;8b2c580d-111a-4434-85f1-3f137b7731b7
```

Expected: zero rows on a new project. If there is already a row, stop and identify that account before changing anything. If it is empty, run this once after replacing the placeholder with the exact UUID from **money-dev → Authentication → Users**:

```sql
insert into public.app_owner (owner_id)
values ('PASTE_DEV_AUTH_USER_UUID_HERE'::uuid);
```

Run the `select owner_id from public.app_owner;` query again. Expected: exactly one row matching your development Auth user. The app's RLS policies check this row on every financial read and write. Supabase's SQL Editor runs with administrative database access, so use it only for this owner registration and versioned migration work; a successful SQL Editor query by itself is **not** proof that browser access is authorized correctly.

Set **Authentication → URL Configuration** to use `http://localhost:3000` for local development, and add `http://localhost:3000/**` as an allowed redirect URL if password-reset flows use redirects. Supabase requires the site/redirect URLs to match the app address used by email actions. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

Stop if more than one unintended account appears. Resolve that before entering financial information. Supabase's user-facing MFA requires an application flow for enrollment and verification; do not assume that enabling MFA on the **Supabase dashboard account** also enables it for this app account. [Supabase app MFA](https://supabase.com/docs/guides/auth/auth-mfa), [Supabase dashboard MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication).

## 7. Run and verify the app locally

```bash
npm run dev
```

Expected: Terminal says the development server is ready, normally at `http://localhost:3000`. Open that address in a browser and sign in with the development owner account. Keep the Terminal window open while using the app; press `Control-C` to stop it.

Use **sample data only** in `money-dev`. A useful first check is:

1. In **Settings & backup → Categories**, choose **Add suggested categories**. Confirm **Food** (expense) and **Rent** (expense) appear; new expenses need a category.
2. Create a **Savings Account** with an opening balance of ₹10,000 and a **Cash Wallet** with an opening balance of ₹0.
3. Add a ₹100 **Food** expense from Savings Account. Expected Savings balance: ₹9,900; food spending: ₹100.
4. Create two goals, allocate a small amount to each, and confirm the allocations reduce available cash but do not increase total assets.
5. Create the current month's plan **from scratch** with a fixed rent line, food budget, and savings line. Review its totals, then choose **Save and activate plan**. Create next month's plan by **copying the current month**, edit one planned amount or due day, and activate it only after reviewing the draft. Confirm planned lines copy but actual transactions do not. If you also set up rent as a recurring item, select it in the plan line's **Linked recurring item** field and check that the same recurring item is not added as a second plan line.
6. Try a transfer from Savings Account to Cash Wallet. Confirm total assets stay the same and linked goal allocations follow the moved funds according to the [design plan](DESIGN_PLAN.md#15-new-additions-and-requirements).

**History safety rule:** A past-dated transfer or investment contribution is rejected if either account has current or past goal-allocation or investment-valuation history; the app cannot safely reconstruct the earlier proportional split. Record such a movement on today's date only if that reflects what actually happened, or stop and review the history before making a correction. **Correct** and **Void** appear only where the app can reverse an entry safely; linked recurring payments, goal-completion payments, and transfers involving goals may require a reviewed manual action rather than a one-click change.

Check the app build before publishing:

```bash
npm run build
```

Expected: exit code 0 and no TypeScript/build errors. A build failure is a stop point: Vercel will build from the same project. If a feature in the design plan is not yet present in the app, do not treat the plan as proof that the feature works; record the gap before entering real data.

### Prove backup recovery before creating production

Supabase Free allows two **active** projects, so do this while only `money-dev` is active. This is a rehearsal with sample data, not your real financial history:

1. In `money-dev`, first confirm the app shows **Synced** and **zero pending transactions** on this device; reconnect and resolve anything marked `Waiting to sync` or `Needs attention` before continuing. Then open **Settings & backup → Encrypted backup** to export an encrypted JSON file. Choose a strong passphrase, save the file in a private folder **outside this code directory**, and note the account balances, number of transactions, and goal totals shown in the app. A backup taken while unsynced could omit transactions that exist only on this device.
2. Create a second Free Supabase project named `money-restore-test`. Keep its database password and project details private. From Terminal, link to it and inspect the migration list:

   ```bash
   npx supabase link --project-ref RESTORE_TEST_PROJECT_REF_HERE
   npx supabase projects list
   npx supabase db push --dry-run
   ```

   Confirm the linked-project indicator and reference in `projects list` match `money-restore-test`; inspect the migration list in the dry run, then run `npx supabase db push`. Expected: an empty copy of the app's schema.
3. In `money-restore-test`, create one Auth user as in step 6, disable new sign-ups, and insert that user's UUID into `public.app_owner` after checking the table is empty. Use the **restore-test UUID**, never the development UUID.
4. Save the development URL and publishable key privately. Change `.env.local` temporarily to `money-restore-test` URL and publishable key. Stop and restart `npm run dev`, sign in as the restore-test owner, and confirm the app has no accounts or transactions before import.
5. In **Settings & backup → Restore an encrypted backup**, choose the encrypted file, enter its passphrase, review the preview, and confirm restore. Compare the restored balances, transaction count, and goal totals with step 1. A second import attempt should be rejected because the database is no longer empty.
6. Restore `.env.local` to the `money-dev` URL and key, then restart the local app. In the `money-restore-test` Supabase dashboard, choose **Settings → General → Project availability → Pause Project**. Check that it says **Paused** before creating `money-prod`; paused projects do not count toward the two-active-project Free limit. Pausing preserves the test project for a limited restore window; Supabase currently says one year. [Supabase Free limit](https://supabase.com/docs/guides/platform/billing-on-supabase), [pause control](https://supabase.com/docs/guides/platform/delete-project#alternative-pause-your-project), [restore window](https://supabase.com/docs/guides/platform/free-project-pausing).

If export, decryption, import, or totals comparison fails, stop here and fix the recovery flow before putting real money records into production. Do not clear the development sample data until the backup test passes.

## 8. Put the code in a private GitHub repository

Create a free personal GitHub account if needed. In GitHub, choose **New repository**, choose your **personal account** as owner, give it a name such as `personal-money-pwa`, and select **Private**. Leave README, license, and `.gitignore` unchecked because the local directory already contains files. GitHub's [create-repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository) and [existing-code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github) guides cover this flow.

Back in Terminal, if this directory is not already a Git repository:

```bash
git init -b main
```

Check exactly what will be uploaded:

```bash
git check-ignore .env.local
git status --short
git add .
git diff --cached --name-only
```

Expected: `.env.local`, `node_modules`, `supabase/.temp/`, and personal backup, CSV, or database-dump files must **not** appear in the staged list. The ignore file includes patterns for the app's export names and common dump extensions, but no pattern catches every filename. Keep all exports **outside this code directory**. If a private file appears, stop before committing or pushing, run `git rm --cached -- path/to/private-file` with its exact path (the `--cached` option keeps your local copy), move the file outside the repository, and inspect the staged list again. Review the staged list for other private files too.

When the staged list contains only code, migrations, and documentation:

```bash
git commit -m "Initial personal money app"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME_HERE/personal-money-pwa.git
git push -u origin main
```

GitHub may open a browser to authenticate. GitHub no longer accepts an account password directly for Git over HTTPS; follow its supported authentication prompt. Expected: the private GitHub repository displays the code and migrations, with no `.env.local` or financial backups. A private source repository does **not** make a deployed Vercel URL private; app sign-in and database RLS are still required.

## 9. Prepare the production Supabase project

In Supabase, create `money-prod` on the Free plan with a **different** strong database password. Record its URL, publishable key, and project reference privately. This project must start empty. Do not import sample data into it.

From this same local directory, explicitly relink to the production project:

```bash
npx supabase link --project-ref PROD_PROJECT_REF_HERE
npx supabase projects list
npx supabase db push --dry-run
```

Check the linked-project indicator and exact reference from `projects list` against the production dashboard. The dry run should show the same reviewed migration files that worked in development. **This is a hard stop point:** do not run the next command unless the linked target and migration list are correct.

```bash
npx supabase db push
```

Expected: migrations apply successfully, production tables appear, and RLS is enabled. Keep subsequent schema changes in new migration files. Apply and test them in development before pushing them to production. [Supabase migration workflow](https://supabase.com/docs/guides/deployment/database-migrations).

Create the single production owner account through **money-prod → Authentication → Users → Add user → Create new user**, as in step 6. Set its password privately and confirm the account appears. Then immediately disable **Allow new users to sign up** in `money-prod`. Copy its production Auth user UUID and register it in **money-prod → SQL Editor**, after verifying `public.app_owner` is empty:

```sql
select owner_id from public.app_owner;
```

Then, replacing the placeholder with the **production** Auth user UUID:

```sql
insert into public.app_owner (owner_id)
values ('PASTE_PROD_AUTH_USER_UUID_HERE'::uuid);
```

Select again and check it matches. Never use the development UUID here. Do not copy development transactions or accounts to production.

## 10. Deploy the website on Vercel

Create a free Vercel account and sign in with your personal GitHub account. Choose **Add New → Project**, import the private `personal-money-pwa` repository from your **personal** GitHub account, and use these settings:

| Setting | Value |
| --- | --- |
| Framework | Next.js (auto-detected) |
| Root directory | Repository root (`./`) |
| Production branch | `main` |
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production publishable key |

Set those two variables for the **Production** environment before choosing **Deploy**. Also add the same variable **names** for the **Preview** environment, but use `money-dev` URL and publishable key as their values. This makes it possible to test the installed PWA on a real phone without putting sample finance records in production. Never point a Preview deployment at `money-prod`. Do not add a database password or a Supabase secret/service-role key to the Vercel project. Vercel documents [Git imports](https://vercel.com/docs/git), [environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables), and the [free Hobby plan](https://vercel.com/docs/plans/hobby). Hobby is intended for personal, noncommercial work; Vercel notes a limitation for private repositories owned by GitHub **organizations** on Hobby, which is why this guide uses a personal account.

Expected: deployment status **Ready**, and a URL like `https://personal-money-pwa.vercel.app`. Open it in a private browser window. Before signing in, no financial data should be visible.

For a phone-accessible **development preview**, create and push a separate branch after the first commit:

```bash
git switch -c verify-pwa
git push -u origin verify-pwa
```

Vercel should create a Preview deployment for that branch. In the Vercel dashboard, open **Deployments**, select the Preview URL, and confirm the app connects to `money-dev`. Use only the development owner sign-in there. Keep the Preview URL out of production Supabase's redirect list. If the preview build needs auth redirects, add its exact URL to **money-dev → Authentication → URL Configuration**. [Vercel Git deployments](https://vercel.com/docs/git), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

After the preview checks in step 12, run `git switch main` to return your local code directory to the production branch. This does not delete the preview branch.

In production Supabase, set **Authentication → URL Configuration → Site URL** to the exact Vercel URL and add that URL to the allowed redirects. Keep `http://localhost:3000/**` only if you still need local auth against this production project; ordinary local development should use `money-dev`. If a confirmation or password-reset email returns to localhost, correct the Site URL and redirects. [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

If you change Vercel environment variables later, save them and **redeploy**; a previous deployment does not automatically receive changed values. [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 11. Install the PWA on your devices

Use the **production HTTPS URL** on every device and sign in with the **same production owner account**.

- **Chrome on a PC or Mac:** Open the site, then use the install icon in the address bar or Chrome's menu → **Cast, save, and share → Install page as app**. [Chrome desktop instructions](https://support.google.com/chrome/answer/9658361?co=genie.platform%3DDesktop&hl=en).
- **Chrome on Android:** Open the site, tap the three-dot menu, then choose **Install** or **Install and create shortcut**, depending on the Chrome version. [Chrome Android instructions](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=en-LR).
- **Safari on iPhone:** Open the site in Safari, tap **Share**, choose **Add to Home Screen**, keep **Open as Web App** enabled if shown, and tap **Add**. [Apple iPhone instructions](https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios).
- **Safari on Mac:** Open the site and choose **File → Add to Dock** if you prefer a standalone app window. [Apple Mac instructions](https://support.apple.com/en-euro/guide/safari/ibrw9e991864/mac).

The installed icon opens the same site and database. Installing does not create a second copy of your account. Offline features depend on the app's actual implementation and on data already cached on that device.

If you installed the **Preview** URL while testing, it may have the same icon and name. Remove that test icon after verification and keep the one opened from the **production** URL for daily use.

## 12. Verify privacy, sync, and the money rules

Use the **Vercel Preview URL connected to `money-dev`** for all sample amounts and the phone PWA test. This keeps test history out of your production ledger:

1. Sign in on your PC and phone with the development owner. Add one small sample expense on the phone. The PC should show it after refresh or while its live session is open. The account balance should change once.
2. Create a goal allocation, then use **Quick Save** with two active goals and a small amount. The amount should be divided exactly between them, even if one goes past its target. Total assets must stay unchanged; available unreserved money falls by the allocation.
3. Move money between accounts. Total assets must stay unchanged; any goal allocation tied to those funds must move under the proportional rule in [design section 15](DESIGN_PLAN.md#15-new-additions-and-requirements). Check the **monthly plan** still shows only one line for an intentionally linked recurring item.
4. Complete a sample goal. The dialog should ask how much was spent and from which accounts. If the goal's own allocation is insufficient, it should ask you which other goals or unreserved funds to use; it must not choose silently.
5. Mark a recurring occurrence paid once. It should create or link a single actual transaction, not duplicate spending.
6. Dismiss a budget or due-date alert. Confirm it stays dismissed on the other device and that a new month's alert is separate.
7. If offline transaction entry is available, disconnect the phone, add a unique small transaction, reconnect, and confirm it appears **once** on both devices. Do not clear browser data while an item says `Waiting to sync` or `Needs attention`.

Then check the **production** app without adding dummy finance records:

1. In a private/incognito browser window, open the production URL without signing in. You should see only sign-in, never account names, transactions, or graphs.
2. Sign in as the production owner, add the income/expense categories you will use (or choose **Add suggested categories** in Settings), then add your first **real** account and opening balance. Verify the balance. From Terminal, test the **database itself** without a sign-in token, after replacing the URL and publishable key with production values:

   ```bash
   curl -i 'https://PROD_PROJECT_REF_HERE.supabase.co/rest/v1/accounts?select=name' \
     -H 'apikey: PASTE_PROD_PUBLISHABLE_KEY_HERE'
   ```

   Expected: a permission error or an empty `[]` response. Your real account name must **not** appear. This checks anonymous database access separately from the app's sign-in screen. The publishable key is meant for browser use; RLS is what protects rows. [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).
3. Sign in to the production URL on your second device with the same production owner. Confirm the first real account and balance appear. Enter a real transaction when one occurs, then confirm it appears once on both devices.

If any total or sync state looks wrong, stop using real amounts and report the exact screen/action and expected versus actual amount. Do not correct a mismatch by editing balances directly; the transaction record is the source of truth.

## 13. Back up and recover

On Supabase Free, automatic database backups are not included. The app's **Settings & backup** screen offers a **passphrase-protected JSON export** and a plain transactions CSV export. Before every backup, confirm **Synced** and **zero pending transactions**; do not rely on an export while an offline entry is still on this device. Export after initial setup and at least monthly; save the encrypted file somewhere separate from the everyday phone/PC, **outside this code directory**, and remember the passphrase. A CSV is readable text: keep it in a private location and do not treat it as an encrypted backup. [Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

The monthly in-app backup reminder is dismissible. A successful encrypted export clears that month's reminder across signed-in devices; the next month's reminder is a separate alert. The browser cannot verify where you saved the downloaded file, so confirm it exists in your private backup location.

The recovery rehearsal in step 7 uses a temporary empty Supabase project before production is created, then pauses that project to keep within the Free limit. For later restore tests, temporarily pause **money-dev** to free an active slot, create another empty test project, and follow the same procedure; pause the test project before resuming `money-dev`. Never pause production merely to test a backup, and never import over production data. The preview should show record counts and totals before import; after import, compare account balances and goal totals with the original. The restore must not create duplicates if run twice. A restore into a new project must map records to that project's **new** Auth owner ID; its value will differ from production.

**Release check:** Do not move all real financial history into the app until an export and a restore into an empty test project have both succeeded and the restored totals match. A file that downloads successfully is not yet a proven backup.

If the app's export/restore feature is not yet implemented, Supabase documents a manual [`db dump` procedure](https://supabase.com/docs/guides/platform/backups), but treat it as an administrator's data extraction, **not** as a one-command restore for this app. The CLI dump runs through a container tool such as Docker and omits Supabase-managed `auth` data by default; this app's tables refer to an Auth owner ID. A new project therefore needs deliberate owner-ID mapping or a verified full migration procedure. CSV alone is also not a complete restore. Store dumps carefully because they contain private financial data. [Supabase CLI dump reference](https://supabase.com/docs/reference/cli/supabase-db-dump), [Supabase backup and restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

If a Free Supabase project pauses after low activity, visit its dashboard, select the paused project, and choose **Resume project**. Supabase states a paused project has a one-year self-service restore window. Until it is running, the app may show a connection error and new offline items may remain pending. [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

## 14. Updating the app later

For a code-only update, work on a new Git branch, run `npm run build`, commit and push that branch, then test its Vercel Preview against `money-dev`. Merge the reviewed branch into `main` on GitHub only after those checks pass. Vercel then builds the new production commit automatically. Keep Preview environment variables connected to development. [Vercel Git deployments](https://vercel.com/docs/git).

For a database change, add a **new** SQL file in `supabase/migrations/`. Link and apply it to development first:

```bash
npx supabase link --project-ref DEV_PROJECT_REF_HERE
npx supabase projects list
npx supabase db push --dry-run
npx supabase db push
```

Verify the changed app against development samples. Take a fresh encrypted production export and confirm the previous restore rehearsal has passed. Then relink to production and inspect the target and migration list **before** the push:

```bash
npx supabase link --project-ref PROD_PROJECT_REF_HERE
npx supabase projects list
npx supabase db push --dry-run
npx supabase db push
```

For **each** block, use `projects list` to verify the linked reference before continuing; `--dry-run` verifies the migrations, not necessarily the project name. The final command is for use only after both checks pass for production. Never run `supabase db reset` against production or make ad hoc production schema changes in the Dashboard. [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## 15. Troubleshooting

| Symptom | Check and next action |
| --- | --- |
| `node: command not found` | Install Node LTS, reopen Terminal, and repeat `node --version`. |
| `npm install` fails | Check the full npm error; confirm Node version and internet access. Do not delete project files to guess at a fix. |
| Git commit says it cannot detect your identity | Configure Git with `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, using your own details, then retry the commit. |
| `npx supabase link` or `db push` fails | Check login, project reference, database password, and that the project is running. Retry `--dry-run` before any push. |
| App cannot connect to Supabase | Confirm URL and publishable key come from the same project; restart `npm run dev` after editing `.env.local`; check whether the Free project paused. |
| Sign-in succeeds but tables look empty or writes fail | Confirm migration applied and the project's `public.app_owner` row matches the signed-in Auth user ID. Do not disable RLS. |
| Confirmation/reset email opens the wrong site | Set Supabase Site URL and allowed redirect URLs to the exact address being used. |
| Vercel build fails | Reproduce with `npm run build` locally, then inspect the Vercel build log and the Production environment variables. |
| Changed Vercel setting seems ignored | Redeploy after changing environment variables. |
| Install option is missing | Open the production HTTPS URL in the supported browser, verify the app has a manifest/icon, and try the browser's menu. |
| Phone and PC disagree | Check both are signed in to the same **production** project, then refresh; inspect `Waiting to sync`/`Needs attention` before creating another transaction. |
| You forgot the app sign-in password | This first version has no in-app reset screen. Keep the password in a password manager; recovery requires an administrator action in Supabase or adding a tested password-reset flow. Do not create a second owner user as a shortcut, because `app_owner` is tied to the first user's UUID. [Supabase password-based Auth](https://supabase.com/docs/guides/auth/passwords). |

Provider interfaces and Free plan quotas can change. The linked official pages are the source for current screen labels and limits; pause at a step if the dashboard no longer matches this guide.
