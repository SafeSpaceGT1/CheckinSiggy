import { expect, test, UNCONFIGURED, USER_EMAIL, USER_ID } from './mock-supabase';

test.describe('Configured production app with synthetic account/data API', () => {
  test.skip(UNCONFIGURED, 'Run against the configured synthetic build.');

  test('protected routes redirect signed-out users to sign in', async ({ page, api }) => {
    await api.install({ signedIn: false });
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    expect(api.calls.filter(call => call.path.startsWith('/rest/'))).toEqual([]);
  });

  test('sign-in reports invalid credentials and preserves the requested destination on retry', async ({ page, api }) => {
    await api.install({ signedIn: false });
    api.signInError = 'Invalid login credentials';
    await page.goto('/auth?returnUrl=%2Fjournal');
    await page.locator('#si-email').fill(USER_EMAIL);
    await page.locator('#si-password').fill('SyntheticPassword1!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText("Email or password doesn't match. Try again.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    api.signInError = null;
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL('/journal');
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
  });

  test('email-confirmation signup stays on auth and explains the next step', async ({ page, api }) => {
    await api.install({ signedIn: false });
    await page.goto('/auth');
    await page.getByRole('tab', { name: 'Sign up', exact: true }).click();
    await page.locator('#su-email').fill(USER_EMAIL);
    await page.locator('#su-password').fill('SyntheticPassword1!');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Check your email to confirm your account' })).toBeVisible();
    await expect(page).toHaveURL('/auth');
    await expect(page.locator('#su-password')).toHaveValue('');
    expect(api.calls.filter(call => call.path.startsWith('/rest/'))).toEqual([]);
  });

  test('immediate-session signup goes to onboarding', async ({ page, api }) => {
    await api.install({ signedIn: false });
    api.signupRequiresConfirmation = false;
    await page.goto('/auth');
    await page.getByRole('tab', { name: 'Sign up', exact: true }).click();
    await page.locator('#su-email').fill(USER_EMAIL);
    await page.locator('#su-password').fill('SyntheticPassword1!');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL('/onboarding');
    await expect(page.getByRole('heading', { name: 'Welcome to SIGGY' })).toBeVisible();
  });

  const routes: Array<[string, string | RegExp]> = [
    ['/', /Good (morning|afternoon|evening),/], ['/mood-check', 'How are you feeling?'],
    ['/journal', 'Journal'], ['/calendar', 'Calendar'], ['/sentiment', 'Sentiment'],
    ['/reminders', 'Reminders'], ['/progress', 'Progress'], ['/insight', 'SIGGY Insight'],
    ['/profile', 'Profile'], ['/settings', 'Settings'], ['/crisis-plan', 'Crisis plan'],
    ['/crisis-plan/edit', 'Edit crisis plan'],
  ];
  for (const [route, heading] of routes) {
    test(`signed-in ${route} loads without uncaught errors`, async ({ page, api }) => {
      await api.install();
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page).toHaveURL(route);
      // Allow deferred query and effect failures to surface before fixture cleanup.
      await page.waitForLoadState('networkidle');
      if (route === '/' && process.env.SIGGY_QA_DIR) {
        await page.screenshot({ path: `${process.env.SIGGY_QA_DIR}/desktop-home.png`, fullPage: true });
      }
    });
  }

  test('detailed mood save persists the intended payload and updates recent history', async ({ page, api }) => {
    await api.install();
    await page.goto('/mood-check');
    await page.getByRole('tab', { name: 'Detailed', exact: true }).click();
    await page.getByRole('button', { name: 'Hopeful', exact: true }).click();
    await page.getByLabel(/Notes/).fill('  Synthetic hopeful check-in.  ');
    await page.getByLabel('Add this to my next session', { exact: true }).check();
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    await expect(page.getByText('Saved to your history.', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recent check-ins' }).getByText('Synthetic hopeful check-in.', { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Notes/)).toHaveValue('');
    expect(api.writes('mood_entries')).toHaveLength(1);
    expect(api.writes('mood_entries')[0].body).toMatchObject({
      user_id: USER_ID, value: 3, rating_10: 5, tags: ['Hopeful'],
      notes: 'Synthetic hopeful check-in.', add_to_next_session: true,
    });
  });

  test('failed mood save keeps the draft for retry and never shows success', async ({ page, api }) => {
    await api.install();
    api.failNext = { table: 'mood_entries', method: 'POST', message: 'Synthetic save unavailable' };
    await page.goto('/mood-check');
    await page.getByRole('tab', { name: 'Detailed', exact: true }).click();
    await page.getByLabel(/Notes/).fill('Synthetic draft to retain.');
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    await expect(page.getByText("Couldn't save", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Notes/)).toHaveValue('Synthetic draft to retain.');
    await expect(page.getByText('Saved to your history.', { exact: true })).toHaveCount(0);
    expect(api.rows.mood_entries).toHaveLength(0);
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    await expect(page.getByText('Saved to your history.', { exact: true })).toBeVisible();
    expect(api.rows.mood_entries).toHaveLength(1);
  });

  test('journal saves, reflects locally when AI is unavailable, and deletes only after confirmation', async ({ page, api }) => {
    await api.install();
    api.analysisUnavailable = true;
    await page.goto('/journal');
    const save = page.getByRole('button', { name: 'Save entry', exact: true });
    await expect(save).toBeDisabled();
    await page.getByLabel("What's on your mind?", { exact: true }).fill('I am grateful and hopeful about my synthetic test day.');
    await page.getByRole('button', { name: 'Tag entry as Good', exact: true }).click();
    await save.click();
    const article = page.getByRole('article').filter({ hasText: 'I am grateful and hopeful about my synthetic test day.' });
    await expect(article).toBeVisible();
    await expect(article.getByText('local', { exact: true })).toBeVisible();
    await expect(page.getByLabel("What's on your mind?", { exact: true })).toHaveValue('');
    expect(api.writes('journal_entries')[0].body).toMatchObject({ user_id: USER_ID, mood: '🙂' });
    expect(api.rows.sentiment_analyses[0]).toMatchObject({ source: 'local', user_id: USER_ID });
    await article.getByRole('button', { name: 'Delete this entry', exact: true }).click();
    await page.getByRole('button', { name: 'Keep', exact: true }).click();
    expect(api.writes('journal_entries', 'DELETE')).toHaveLength(0);
    await expect(article).toBeVisible();
    await article.getByRole('button', { name: 'Delete this entry', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(article).toHaveCount(0);
    await expect(page.getByText('No entries yet', { exact: true })).toBeVisible();
    expect(api.writes('journal_entries', 'DELETE')).toHaveLength(1);
  });

  test('journal save failure preserves the entry and allows retry', async ({ page, api }) => {
    await api.install();
    api.failNext = { table: 'journal_entries', method: 'POST', message: 'Synthetic journal unavailable' };
    await page.goto('/journal');
    const draft = page.getByLabel("What's on your mind?", { exact: true });
    await draft.fill('Synthetic unsaved journal.');
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByText('Something went wrong', { exact: true })).toBeVisible();
    await expect(draft).toHaveValue('Synthetic unsaved journal.');
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save entry', exact: true })).toBeEnabled();
  });

  test('journal read failure shows an actionable error instead of an empty history', async ({ page, api }) => {
    await api.install();
    api.unavailableTables.add('journal_entries');
    await page.goto('/journal');
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load your journal" })).toBeVisible();
    await expect(page.getByText('No entries yet', { exact: true })).toHaveCount(0);
    api.unavailableTables.delete('journal_entries');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('No entries yet', { exact: true })).toBeVisible();
  });

  test('appearance persists across reload, and sign-out protects a subsequent direct URL', async ({ page, api }) => {
    await api.install();
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.getByText(`Signed in as ${USER_EMAIL}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Sign out$/ }).click();
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    const session = await page.evaluate(() => localStorage.getItem('sb-siggy-e2e-auth-token'));
    expect(session).toBeNull();
  });

  test('client mode gates clinician presentation; enabling tools changes the navigation', async ({ page, api }) => {
    await api.install({ role: 'client' });
    await page.goto('/clients');
    await expect(page.getByText('Clinician tools are off', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search clients', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Enable clinician tools', exact: true }).click();
    await expect(page.getByText('Clinician tools are off', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
    await page.goto('/soap-notes');
    await expect(page.getByRole('heading', { name: 'Session notes', exact: true })).toBeVisible();
    // This is a UI preference test. Database authorization is tested separately.
  });

  test('JSON export downloads every page and includes correctly scoped clinician records', async ({ page, api }) => {
    await api.install({ role: 'clinician' });
    api.rows.journal_entries = Array.from({ length: 501 }, (_, index) => ({
      id: `journal-fixture-${index}`, user_id: USER_ID,
      content: 'Synthetic export fixture.', created_at: '2026-09-01T12:00:00Z', mood: null,
    }));
    api.rows.clients = [{ id: 'client-fixture', therapist_id: USER_ID, name: 'Synthetic client', created_at: '2026-09-01T12:00:00Z' }];
    api.rows.soap_notes = [{ id: 'note-fixture', therapist_id: USER_ID, client_id: 'client-fixture', content: { plan: 'Synthetic fixture.' } }];
    await page.goto('/profile');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download JSON export/ }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    if (!stream) throw new Error('Export did not provide a downloadable file.');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(payload.user.id).toBe(USER_ID);
    expect(payload.data.journal_entries).toHaveLength(501);
    expect(payload.data.clients).toHaveLength(1);
    expect(payload.data.soap_notes).toHaveLength(1);
    for (const table of ['clients', 'soap_notes']) {
      const calls = api.calls.filter(call => call.path === `/rest/v1/${table}`);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every(call => call.search.get('therapist_id') === `eq.${USER_ID}`)).toBe(true);
    }
    await expect(page.getByText('Your data is downloading as JSON.', { exact: true })).toBeVisible();
  });

  test('small-screen check-in controls remain usable without horizontal overflow', async ({ page, api }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await api.install();
    await page.goto('/mood-check');
    if (process.env.SIGGY_QA_DIR) {
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${process.env.SIGGY_QA_DIR}/mobile-mood.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Check in as Great', exact: true }).click();
    await expect(page.getByText('Saved to your history.', { exact: true })).toBeVisible();
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows).toBe(false);
  });
});

test.describe('Unconfigured deployment', () => {
  test.skip(!UNCONFIGURED, 'Run against a build with empty Supabase environment values.');

  test('auth explains setup and disables sign-in and signup without network requests', async ({ page, api }) => {
    await api.install({ signedIn: false });
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByRole('alert').filter({ hasText: 'Setup required' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'Sign up', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled();
    expect(api.calls).toEqual([]);
  });
});
