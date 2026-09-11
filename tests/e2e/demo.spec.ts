import { expect, test as base, type Page } from '@playwright/test';

// Exercise the application's own demo adapter. No mock account/data API is
// installed: any attempted external account, database, or AI request fails.
const test = base.extend<{ offlineDemo: void }>({
  offlineDemo: [async ({ page, context, baseURL }, use) => {
    const externalRequests: string[] = [];
    const errors: string[] = [];
    const appOrigin = new URL(baseURL!).origin;
    const monitor = (tab: Page) => {
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('dialog', dialog => dialog.accept());
    };
    monitor(page);
    context.on('page', monitor);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === appOrigin || ['data:', 'blob:'].includes(url.protocol)) {
        return route.continue();
      }
      if (url.origin === 'https://fonts.googleapis.com') {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      }
      externalRequests.push(`${route.request().method()} ${url.href}`);
      return route.abort('blockedbyclient');
    });
    await use();
    expect(externalRequests, 'Demo must not contact an external account/data/AI service').toEqual([]);
    expect(errors, 'Demo pages must not raise uncaught browser errors').toEqual([]);
  }, { auto: true }],
});

const DATA_KEY = 'siggy:demo:data:v1';
const ACTIVE_KEY = 'siggy:demo:active';

async function expectDemo(page: Page) {
  const banner = page.getByRole('complementary', { name: 'Demo mode', exact: true });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Reset demo', exact: true })).toBeVisible();
  await expect(banner.getByRole('button', { name: 'Exit demo', exact: true })).toBeVisible();
}

async function enterDemo(page: Page) {
  await page.goto('/?demo=1');
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
  await expectDemo(page);
}

async function enableClinician(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'A clinician', exact: true }).click();
}

test.describe('Interactive demo with no backend', () => {
  test('Explore demo opens the full app from the sign-in screen', async ({ page }) => {
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
    await expectDemo(page);
    await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), ACTIVE_KEY)).toBeTruthy();
    await page.goto('/journal');
    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('direct demo entry exposes every main page with sample history', async ({ page }) => {
    test.setTimeout(60_000);
    await enterDemo(page);
    const routes: Array<[string, string]> = [
      ['/mood-check', 'How are you feeling?'], ['/journal', 'Journal'],
      ['/calendar', 'Calendar'], ['/sentiment', 'Sentiment'], ['/reminders', 'Reminders'],
      ['/progress', 'Progress'], ['/insight', 'SIGGY Insight'], ['/profile', 'Profile'],
      ['/settings', 'Settings'], ['/crisis-plan', 'Crisis plan'],
      ['/crisis-plan/edit', 'Edit crisis plan'],
    ];
    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expectDemo(page);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
      if (route === '/journal') await expect(page.getByRole('article').first()).toBeVisible();
      if (route === '/mood-check') {
        await expect(page.getByRole('region', { name: 'Recent check-ins' })).not.toContainText('No check-ins yet');
      }
      if (route === '/profile') {
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: /Download JSON export$/ }).click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toMatch(/^siggy-demo-export-\d{4}-\d{2}-\d{2}\.json$/);
        const stream = await download.createReadStream();
        if (!stream) throw new Error('Demo export did not provide downloadable JSON.');
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        expect(exported).toMatchObject({
          demo: true,
          user: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
        });
        for (const table of ['mood_entries', 'journal_entries', 'clients', 'soap_notes']) {
          expect(exported.data[table].length, `Demo export includes sample ${table}`).toBeGreaterThan(0);
        }
      }
    }
    await enableClinician(page);
    await page.goto('/clients');
    await expect(page.locator('a[href^="/client-profile/"]').first()).toBeVisible();
    await page.locator('a[href^="/client-profile/"]').first().click();
    await expect(page.getByRole('button', { name: /New session note$/ })).toBeVisible();
    await page.goto('/soap-notes');
    await expect(page.getByRole('heading', { name: 'Session notes', exact: true })).toBeVisible();
    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('mood check-ins persist across reload and Reset demo restores the sample', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/mood-check');
    await page.getByRole('tab', { name: 'Detailed', exact: true }).click();
    await page.getByRole('button', { name: 'Hopeful', exact: true }).click();
    await page.getByLabel(/Notes/).fill('Demo-only mood entry to reset.');
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    const history = page.getByRole('region', { name: 'Recent check-ins' });
    await expect(history.getByText('Demo-only mood entry to reset.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(history.getByText('Demo-only mood entry to reset.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
    await page.goto('/mood-check');
    await expect(history.getByText('Demo-only mood entry to reset.', { exact: true })).toHaveCount(0);
    await expect(history).not.toContainText('No check-ins yet');
    await expectDemo(page);
  });

  test('journal saves a local reflection, retains it on reload, and deletes it', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/journal');
    const content = 'I am grateful for a calm demo day and a hopeful new beginning.';
    await page.getByLabel("What's on your mind?", { exact: true }).fill(content);
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    const article = page.getByRole('article').filter({ hasText: content });
    await expect(article).toBeVisible();
    await expect(article.getByText('local', { exact: true })).toBeVisible();
    await page.reload();
    await expect(article).toBeVisible();
    await article.getByRole('button', { name: 'Delete this entry', exact: true }).click();
    await page.getByRole('button', { name: 'Keep', exact: true }).click();
    await expect(article).toBeVisible();
    await article.getByRole('button', { name: 'Delete this entry', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(article).toHaveCount(0);
    await page.reload();
    await expect(article).toHaveCount(0);
    await expect(page.getByRole('article').first()).toBeVisible();
  });

  test('insight generation and journal history reflection work locally after a new entry', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/journal');
    const content = 'I feel calm and hopeful after taking a walk and practicing gratitude in the demo.';
    await page.getByLabel("What's on your mind?", { exact: true }).fill(content);
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('article').filter({ hasText: content })).toBeVisible();
    await page.goto('/insight');
    await page.getByRole('button', { name: 'Generate insight', exact: true }).click();
    const stats = page.getByRole('region', { name: 'Statistics', exact: true });
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('Days checked in');
    await expect(stats.locator('.stat-value').first()).toHaveText(/\d+\s*\/\s*30/);
    await expect(page.getByRole('region', { name: 'Narrative summary', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Copy session prep$/ })).toBeEnabled();
    await page.getByRole('button', { name: '7 days', exact: true }).click();
    await expect(stats.locator('.stat-value').first()).toHaveText(/\d+\s*\/\s*7/);
    await page.getByRole('button', { name: 'Regenerate insight', exact: true }).click();
    await expect(stats.locator('.stat-value').first()).toHaveText(/\d+\s*\/\s*7/);
    await page.goto('/sentiment');
    await page.getByRole('button', { name: 'Reflect now', exact: true }).click();
    const reflection = page.getByRole('region', { name: 'Reflection', exact: true });
    await expect(reflection).toContainText('Demo reflection calculated locally. No live AI.');
    await expect(reflection.getByRole('button', { name: 'Reflect again', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  });

  test('goals toggle completion and reminders can be created and deleted with reload persistence', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/progress');
    const goalTitle = 'Demo goal: a short walk';
    await page.getByRole('button', { name: /New goal$/ }).click();
    await page.getByLabel('Goal', { exact: true }).fill(goalTitle);
    await page.getByRole('button', { name: 'Add goal', exact: true }).click();
    const goal = page.locator('div.glass-card').filter({ has: page.getByText(goalTitle, { exact: true }) });
    await expect(goal.getByRole('button', { name: 'Mark today', exact: true })).toBeVisible();
    await expect(goal).toContainText(/0 of \d this week/);
    await goal.getByRole('button', { name: 'Mark today', exact: true }).click();
    await expect(goal.getByRole('button', { name: 'Done today', exact: true })).toBeVisible();
    await expect(goal).toContainText(/1 of \d this week/);
    await page.reload();
    await expect(goal.getByRole('button', { name: 'Done today', exact: true })).toBeVisible();
    await goal.getByRole('button', { name: 'Done today', exact: true }).click();
    await expect(goal.getByRole('button', { name: 'Mark today', exact: true })).toBeVisible();
    await expect(goal).toContainText(/0 of \d this week/);

    await page.goto('/reminders');
    const reminderTitle = 'Demo reminder to pause';
    await page.getByRole('button', { name: /New$/ }).click();
    await page.getByLabel('Title', { exact: true }).fill(reminderTitle);
    await page.getByLabel('Time', { exact: true }).fill('14:35');
    await page.getByRole('button', { name: 'Save reminder', exact: true }).click();
    const reminder = page.locator('div.glass-card').filter({ has: page.getByText(reminderTitle, { exact: true }) });
    await expect(reminder).toBeVisible();
    await expect(reminder).toContainText('2:35 PM');
    await page.reload();
    await expect(reminder).toBeVisible();
    await reminder.getByRole('button', { name: 'Delete reminder', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(reminder).toHaveCount(0);
    await page.reload();
    await expect(reminder).toHaveCount(0);
  });

  test('clinician tools add a demo client and a session note without a server', async ({ page }) => {
    await enterDemo(page);
    await enableClinician(page);
    await page.goto('/clients');
    await page.getByRole('button', { name: /Add$/ }).click();
    await page.getByLabel('Name', { exact: true }).fill('Demo Browser Client');
    await page.getByLabel('Client email', { exact: true }).fill('demo.browser@example.invalid');
    await page.getByRole('button', { name: 'Add client', exact: true }).click();
    await page.getByRole('link').filter({ hasText: 'Demo Browser Client' }).click();
    await expect(page.getByRole('heading', { name: 'Demo Browser Client', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /New session note$/ }).click();
    await page.locator('#section-subjective').fill('Synthetic demo note: practiced a calming exercise.');
    await page.getByRole('button', { name: 'Save note', exact: true }).click();
    const note = page.getByRole('article').filter({ hasText: 'Synthetic demo note: practiced a calming exercise.' });
    await expect(note).toBeVisible();
    await page.reload();
    await expect(note).toBeVisible();
    await note.getByRole('button', { name: 'Delete note', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(note).toHaveCount(0);
  });

  test('crisis-plan edits and share previews remain local and can be revoked', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/crisis-plan/edit');
    const coping = page.getByLabel('Add to Things I can do myself', { exact: true });
    await coping.fill('Demo coping step: pause and listen to a favorite song.');
    await coping.press('Enter');
    await expect(coping).toHaveValue('');
    await page.getByRole('button', { name: 'Done — view my plan', exact: true }).click();
    await expect(page.getByText('Demo coping step: pause and listen to a favorite song.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Share$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Preview plan sharing', exact: true });
    await expect(dialog).toContainText('Demo links work only in this demo tab. Nothing is sent or published.');
    await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
    const linkText = dialog.locator('p').filter({ hasText: /\/shared-plan\// }).first();
    await expect(linkText).toBeVisible();
    const shareUrl = (await linkText.textContent())!.trim();
    expect(new URL(shareUrl).searchParams.get('demo')).toBe('1');
    await page.goto(shareUrl);
    await expect(page.getByRole('heading', { name: 'Shared crisis plan', exact: true })).toBeVisible();
    await expect(page.getByText('Demo coping step: pause and listen to a favorite song.', { exact: true })).toBeVisible();
    await page.goto('/crisis-plan');
    await page.getByRole('button', { name: /Share$/ }).click();
    await page.getByRole('button', { name: 'Revoke link', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Revoke link', exact: true })).toHaveCount(0);
    await page.goto(shareUrl);
    await expect(page.getByText("This link isn't available", { exact: true })).toBeVisible();
  });

  test('exiting clears only demo state and preserves existing account preferences', async ({ page }) => {
    const existing = {
      'sb-existing-project-auth-token': '{"access_token":"synthetic-existing-account-sentinel"}',
      'siggy:settings': JSON.stringify({ theme: 'light', soundEnabled: false, hapticsEnabled: false, reviewIntervalDays: 120 }),
      userRole: 'client',
      'siggy:role:11111111-1111-4111-8111-111111111111': 'client',
    };
    await page.addInitScript(values => {
      if (!sessionStorage.getItem('demo-test-preferences-seeded')) {
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
        sessionStorage.setItem('demo-test-preferences-seeded', '1');
      }
    }, existing);
    await enterDemo(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'A clinician', exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    // Demo writes must leave the original account values completely untouched.
    expect(await page.evaluate(keys => Object.fromEntries(
      keys.map(key => [key, localStorage.getItem(key)]),
    ), Object.keys(existing))).toEqual(existing);
    await page.getByRole('complementary', { name: 'Demo mode', exact: true })
      .getByRole('button', { name: 'Exit demo', exact: true }).click();
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Explore demo', exact: true })).toBeVisible();
    const stored = await page.evaluate(keys => ({
      account: Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])),
      demo: Object.keys(sessionStorage).filter(key => key.startsWith('siggy:demo:')),
    }), Object.keys(existing));
    for (const [key, value] of Object.entries(existing)) {
      if (key === 'siggy:settings') {
        // Starting the real SettingsService normalizes JSON property order.
        expect(JSON.parse(stored.account[key]!)).toEqual(JSON.parse(value));
      } else {
        expect(stored.account[key]).toBe(value);
      }
    }
    expect(stored.demo).toEqual([]);
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
  });

  test('signing out in one demo tab keeps another tab signed in with its draft and sample data', async ({ page, context }) => {
    await enterDemo(page);
    const second = await context.newPage();
    await enterDemo(second);
    await second.goto('/journal');
    await expect(second.getByRole('article').first()).toBeVisible();
    const initialCount = await second.getByRole('article').count();
    const initialData = await second.evaluate(key => sessionStorage.getItem(key), DATA_KEY);
    const draft = 'This synthetic journal draft belongs only to the second demo tab.';
    await second.getByLabel("What's on your mind?", { exact: true }).fill(draft);

    // This path calls Supabase auth.signOut(), which must not broadcast into
    // another independent demo tab even though both share the same origin.
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: /Sign out$/ }).click();
    await expect(page).toHaveURL(/\/auth(?:\?|$)/);
    await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);

    await expectDemo(second);
    await expect(second.getByLabel("What's on your mind?", { exact: true })).toHaveValue(draft);
    await expect(second.getByRole('article')).toHaveCount(initialCount);
    expect(await second.evaluate(key => sessionStorage.getItem(key), DATA_KEY)).toBe(initialData);
    await second.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(second.getByRole('article').filter({ hasText: draft })).toBeVisible();
    await expect(second.getByRole('article')).toHaveCount(initialCount + 1);
    await second.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(second.getByRole('heading', { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
    await second.getByRole('link', { name: 'Journal', exact: true }).click();
    await expect(second.getByRole('article').filter({ hasText: draft })).toBeVisible();
    await expectDemo(second);
    await second.close();
  });

  test('storage-denied browsers can still explore and save within the current page session', async ({ page }) => {
    await page.addInitScript(() => {
      const blocked = () => { throw new DOMException('Storage disabled for demo test', 'SecurityError'); };
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get: blocked });
      Object.defineProperty(window, 'localStorage', { configurable: true, get: blocked });
    });
    await enterDemo(page);
    // Client-side navigation keeps the in-memory fallback alive when reload
    // persistence is impossible because this browser denies storage access.
    await page.getByRole('link', { name: 'Journal', exact: true }).click();
    await page.getByLabel("What's on your mind?", { exact: true }).fill('Demo entry saved with browser storage disabled.');
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await expect(page.getByRole('article').filter({ hasText: 'Demo entry saved with browser storage disabled.' })).toBeVisible();
    await expectDemo(page);
  });

  test('mobile demo controls and mood check-in stay usable without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterDemo(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await page.goto('/mood-check');
    await expectDemo(page);
    await page.getByRole('button', { name: 'Check in as Great', exact: true }).click();
    await expect(page.getByText('Saved to your history.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    expect(await page.evaluate(key => sessionStorage.getItem(key), DATA_KEY)).toBeTruthy();
  });
});
